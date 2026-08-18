-- =============================================================================
-- Veveaham Alumni Network — Migration v2
-- =============================================================================
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- It is IDEMPOTENT: running it twice is safe.
--
-- WHAT THIS FIXES
--   1. CRITICAL: every approved alumnus's personal_email + phone_number were
--      readable by anyone with the public anon key (verified in production).
--      RLS filtered rows, never columns. We add a safe public view and revoke
--      anon's access to the raw table.
--   2. Adds staging for profile edits so "Edits Under Review" is finally true.
--   3. Turns field_options into a moderated queue (pending -> approved) so the
--      option lists grow verified instead of accumulating junk like 'bsms'.
--   4. Adds an organizations table so companies get the same treatment as colleges.
--   5. Migrates school names to the three official names.
--
-- ORDER MATTERS: run top to bottom. Section 9 has verification queries —
-- run those last and check the output matches what's described.
-- =============================================================================


-- =============================================================================
-- 1. Columns needed by the new flows
-- =============================================================================

-- Staging area for profile edits made by ALREADY-APPROVED alumni. The live
-- columns (what the public sees) stay untouched until an admin approves.
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS pending_changes JSONB;

COMMENT ON COLUMN alumni.pending_changes IS
  'Staged profile edits awaiting admin approval. NULL = nothing pending. Live columns remain the published version.';


-- =============================================================================
-- 2. The safe public view  (fixes the PII leak)
-- =============================================================================
-- Only non-private columns of APPROVED alumni. Deliberately EXCLUDED:
--   personal_email, phone_number, phone_country_code  <- the leak
--   admission_number, user_id, rejection_reason, original_data, pending_changes
--   consent_given, modification_status, last_updated
--
-- College details are embedded as a nested JSON object named "colleges" so the
-- existing client helpers (collegeNameOf / collegeDetailsOf in lib/types.ts)
-- keep working unchanged.

DROP VIEW IF EXISTS public_alumni;

-- IMPORTANT: this view intentionally uses Postgres's default "owner's rights"
-- execution (i.e. NOT security_invoker). That is what lets an anonymous
-- visitor read the view after we revoke their SELECT on the alumni table in
-- section 3. The safety comes from the view itself: it filters to approved
-- rows and simply does not select the private columns.
CREATE VIEW public_alumni AS
SELECT
  a.id,
  a.full_name,
  a.username,
  a.school_name,
  a.school_board,
  a.class_of,
  a.stream,
  a.degree,
  a.branch,
  a.field,
  a.current_status,
  a.currently_at,
  a.designation,
  a.expected_finish_year,
  a.admission_route,
  a.admission_rank,
  a.board_marks,
  a.board_cutoff,
  a.linkedin_url,
  a.message_1,
  a.message_2,
  a.show_photo,
  -- Never hand out a photo URL when the alumnus opted out of showing it.
  CASE WHEN a.show_photo THEN a.photo_url ELSE NULL END AS photo_url,
  a.college_id,
  a.college_name_raw,
  a.created_at,
  CASE WHEN c.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',             c.name,
      'state',            c.state,
      'district',         c.district,
      'website',          c.website,
      'university_name',  c.university_name,
      'management_type',  c.management_type,
      'established_year', c.established_year,
      'is_engineering',   c.is_engineering
    )
  END AS colleges
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
WHERE a.approval_status = 'approved';

GRANT SELECT ON public_alumni TO anon, authenticated;

COMMENT ON VIEW public_alumni IS
  'Public, privacy-safe projection of approved alumni. Contact details are intentionally absent. The site reads this instead of the alumni table.';


-- =============================================================================
-- 3. Revoke anon's direct access to the raw alumni table  (closes the leak)
-- =============================================================================
-- NOTE: we revoke SELECT only. INSERT stays so registration keeps working.
-- "authenticated" keeps SELECT because alumni need to read their own profile
-- and admins need the dashboard — both are still constrained by RLS policies.

REVOKE SELECT ON alumni FROM anon;

-- Study / work timelines are shown on public profile cards, so they stay
-- readable. But their existing policy was USING (true), which also published
-- the timelines of people who are still PENDING or were REJECTED - profiles the
-- directory deliberately hides. Scope both to approved alumni to match.
GRANT SELECT ON higher_studies  TO anon, authenticated;
GRANT SELECT ON work_experience TO anon, authenticated;

DROP POLICY IF EXISTS "Higher studies are publicly viewable" ON higher_studies;
CREATE POLICY "Higher studies of approved alumni are public"
  ON higher_studies FOR SELECT
  TO anon, authenticated
  USING (
    alumni_id IN (SELECT id FROM alumni WHERE approval_status = 'approved')
  );

DROP POLICY IF EXISTS "Work experience is publicly viewable" ON work_experience;
CREATE POLICY "Work experience of approved alumni is public"
  ON work_experience FOR SELECT
  TO anon, authenticated
  USING (
    alumni_id IN (SELECT id FROM alumni WHERE approval_status = 'approved')
  );


-- =============================================================================
-- 4. Username availability RPC
-- =============================================================================
-- Registration used to check "is this username taken?" with a SELECT on alumni
-- as anon. That's exactly the access we just revoked, so expose the single
-- yes/no answer instead of the table. SECURITY DEFINER = runs as the owner,
-- returns only a boolean, leaks nothing else.

CREATE OR REPLACE FUNCTION username_available(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM alumni
    WHERE lower(username) = lower(trim(candidate))
  );
$$;

GRANT EXECUTE ON FUNCTION username_available(TEXT) TO anon, authenticated;


-- =============================================================================
-- 5. field_options becomes a moderated queue
-- =============================================================================
-- Today a student's free-typed "Other" answer could become a real dropdown
-- option immediately — that's how 'arts' and 'bsms' (lowercase) got in.
-- Now: submissions land as 'pending' and an admin merges/canonicalises/approves.

ALTER TABLE field_options
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS canonical_value TEXT,
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_count INTEGER NOT NULL DEFAULT 1;

-- Guard against typos in status values.
ALTER TABLE field_options DROP CONSTRAINT IF EXISTS field_options_status_check;
ALTER TABLE field_options ADD CONSTRAINT field_options_status_check
  CHECK (status IN ('pending', 'approved'));

-- Stop the same (category, value) pair being queued twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_options_cat_value_lower
  ON field_options (category, lower(value));

ALTER TABLE field_options ENABLE ROW LEVEL SECURITY;

-- Everyone may read APPROVED options (they populate the dropdowns).
DROP POLICY IF EXISTS "Approved options are public" ON field_options;
CREATE POLICY "Approved options are public"
  ON field_options FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- A registering student may propose a new option, but ONLY as 'pending'.
DROP POLICY IF EXISTS "Anyone can propose an option" ON field_options;
CREATE POLICY "Anyone can propose an option"
  ON field_options FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'pending');

-- Admins see and manage everything.
DROP POLICY IF EXISTS "Admins manage options" ON field_options;
CREATE POLICY "Admins manage options"
  ON field_options FOR ALL
  TO authenticated
  USING (auth.email() LIKE '%@veveaham-admin.local')
  WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- The two values already in the table were auto-promoted by the old button and
-- are not properly capitalised. Send them back through review rather than
-- leaving them as blessed options.
UPDATE field_options SET status = 'pending'
WHERE value IN ('arts', 'bsms') AND status = 'approved';


-- =============================================================================
-- 6. organizations table  (companies get the college treatment)
-- =============================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  kind           TEXT DEFAULT 'company',   -- company | institute | government | other
  added_by_admin BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_name_lower
  ON organizations (lower(name));

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizations are publicly readable" ON organizations;
CREATE POLICY "Organizations are publicly readable"
  ON organizations FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage organizations" ON organizations;
CREATE POLICY "Admins manage organizations"
  ON organizations FOR ALL
  TO authenticated
  USING (auth.email() LIKE '%@veveaham-admin.local')
  WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- Link alumni to a verified organization (kept alongside the free-text
-- currently_at, exactly like college_id sits alongside college_name_raw).
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_organization_id ON alumni(organization_id);

-- Seed with well-known employers so suggestions work from day one.
INSERT INTO organizations (name, kind, added_by_admin)
SELECT v, 'company', true FROM (VALUES
  ('TCS'),('Infosys'),('Wipro'),('HCLTech'),('Tech Mahindra'),('Cognizant'),
  ('Accenture'),('Capgemini'),('LTIMindtree'),('Zoho'),('Freshworks'),
  ('Google'),('Microsoft'),('Amazon'),('Meta'),('Apple'),('Adobe'),('Nvidia'),
  ('Salesforce'),('Uber'),('Flipkart'),('Swiggy'),('Zomato'),('PhonePe'),
  ('Razorpay'),('CRED'),('Paytm'),('Deloitte'),('PwC'),('EY'),('KPMG'),
  ('McKinsey & Company'),('BCG'),('Bain & Company'),('Goldman Sachs'),
  ('JPMorgan Chase'),('Morgan Stanley'),('ISRO'),('DRDO'),('BHEL'),('L&T'),
  ('Tata Motors'),('Mahindra'),('Qualcomm'),('Texas Instruments'),
  ('Apollo Hospitals'),('Fortis Healthcare'),('AIIMS'),('CMC Vellore')
) AS t(v)
ON CONFLICT DO NOTHING;

-- Deliberately NOT seeded from whatever alumni have typed into currently_at.
-- Those values are raw and inconsistent ('VIT,chennai', 'IISER THIRUVANADHAPURAM'),
-- and copying them in would defeat the point of a curated list. They stay as
-- free text on each profile and surface in the admin dashboard's "Unmatched
-- Companies" tab, where staff correct the spelling once and link everyone who
-- typed it to the same clean record.


-- =============================================================================
-- 7. Official school names
-- =============================================================================
-- The form offered labels that no longer match how the schools are named, and
-- one default ('Veveaham Group Of Schools') matched no option at all.
--
-- Current production data: 15 rows 'Veveaham Hr. Sec. School',
--                           3 rows 'Veveaham Prime Academy',
--                           1 row  'Veveaham Group Of Schools'.
--
-- Per decision: existing rows map to the GIRLS school. If you would rather they
-- go to the Boys school, change the target string in the UPDATE below before
-- running (it appears once).

UPDATE alumni
SET school_name = 'Veveaham Higher Secondary School (Girls)'
WHERE school_name IN (
  'Veveaham Hr. Sec. School',
  'Veveaham Group Of Schools',
  'Veveaham Hr Sec School'
);

UPDATE alumni
SET school_name = 'Veveaham Prime Academy'
WHERE school_name ILIKE '%prime%academy%';


-- =============================================================================
-- 8. Light data cleanup  (safe, reviewed)
-- =============================================================================
-- Production currently holds 'Science' / 'Sciences' / 'science' as three
-- different fields, which splits the directory's category chips.
UPDATE alumni SET field = 'Sciences'
WHERE lower(btrim(field)) IN ('science', 'sciences');

UPDATE alumni SET field = 'Engineering' WHERE lower(btrim(field)) = 'engineering';
UPDATE alumni SET field = 'Medicine'    WHERE lower(btrim(field)) = 'medicine';

-- The commerce category was renamed when the field list was expanded; bring the
-- stored value in line so those profiles keep their chip instead of falling
-- through to "Other".
UPDATE alumni SET field = 'Commerce & Finance'
WHERE lower(btrim(field)) IN ('business & finance', 'commerce', 'business and finance');

-- 'bsms' and 'BSMS' are the same degree typed two ways.
UPDATE alumni SET degree = 'BSMS' WHERE lower(btrim(degree)) = 'bsms';

-- Placeholder junk that renders as a literal dash on the public card.
UPDATE alumni SET branch = NULL WHERE btrim(branch) IN ('-', '--', 'na', 'NA', 'N/A', '.');

-- NOTE: the test/duplicate rows (e.g. the repeated "harshita" entries and the
-- field value 'kkk') are NOT deleted here. Use the new Delete button in the
-- admin dashboard so the photo and auth account are cleaned up too.


-- =============================================================================
-- 9. VERIFICATION — run these and check the results
-- =============================================================================
-- 9a. Should return TRUE. The view must not expose any contact column.
SELECT NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'public_alumni'
    AND column_name IN ('personal_email','phone_number','phone_country_code','admission_number')
) AS view_has_no_contact_columns;

-- 9b. Should return NO rows. anon must not hold SELECT on alumni any more.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'alumni' AND grantee = 'anon' AND privilege_type = 'SELECT';

-- 9c. Should return TRUE (the username RPC works and is callable).
SELECT username_available('definitely_not_taken_zzz') AS rpc_works;

-- 9d. School names after migration — expect only the official names.
SELECT school_name, count(*) FROM alumni GROUP BY school_name ORDER BY 2 DESC;

-- 9e. The view should return the same number of people as before (19).
SELECT count(*) AS approved_visible FROM public_alumni;

-- 9f. Options queue state.
SELECT status, count(*) FROM field_options GROUP BY status;

-- 9g. Organizations seeded.
SELECT count(*) AS organizations_count FROM organizations;


-- =============================================================================
-- ROLLBACK (only if something goes wrong — undoes the access changes)
-- =============================================================================
-- GRANT SELECT ON alumni TO anon;      -- re-opens the PII leak, avoid
-- DROP VIEW IF EXISTS public_alumni;
-- =============================================================================
