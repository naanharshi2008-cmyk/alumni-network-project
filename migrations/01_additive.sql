-- =============================================================================
-- Veveaham Alumni Network — Migration v2, PART 1 of 2: ADDITIVE
-- =============================================================================
-- RUN THIS FIRST, and run it BEFORE deploying the new code.
--
-- Everything here only ADDS: new columns, a new view, a new function, a new
-- table, and some data tidying. Nothing is taken away, so the site that is
-- live right now keeps working exactly as it does today while this runs.
--
-- Part 2 (02_lockdown.sql) is what actually closes the privacy leak, and it
-- must NOT run until the new code is live. See the header of that file.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Everything you paste runs as ONE transaction: if any statement fails,
--   nothing is applied. Fix the cause and re-run the whole file.
--   Re-running this file on an already-migrated database is safe.
--
--   The editor only shows the result of the LAST statement. To read the
--   verification results at the end, highlight each one and run it on its own.
-- =============================================================================


-- =============================================================================
-- 1. New columns
-- =============================================================================

-- Staging area for profile edits made by ALREADY-APPROVED alumni. The live
-- columns (what the public sees) stay untouched until an admin approves.
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS pending_changes JSONB;

COMMENT ON COLUMN alumni.pending_changes IS
  'Staged profile edits awaiting admin approval. NULL = nothing pending. Live columns remain the published version.';


-- =============================================================================
-- 2. The safe public view
-- =============================================================================
-- Only non-private columns of APPROVED alumni. Deliberately EXCLUDED:
--   personal_email, phone_number, phone_country_code  <- the leak
--   admission_number, user_id, rejection_reason, original_data, pending_changes
--   consent_given, modification_status, last_updated
--
-- College details are embedded as a nested JSON object named "colleges" so the
-- client helpers (collegeNameOf / collegeDetailsOf in lib/types.ts) keep
-- working unchanged.
--
-- IMPORTANT: this view intentionally uses Postgres's default "owner's rights"
-- execution (i.e. NOT security_invoker). That is what lets an anonymous
-- visitor read it after part 2 revokes their SELECT on the alumni table. The
-- safety comes from the view itself: it filters to approved rows and simply
-- does not select the private columns.

DROP VIEW IF EXISTS public_alumni;

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
-- 3. Username availability RPC
-- =============================================================================
-- Registration checks "is this username taken?". It used to do that with a
-- SELECT on alumni as anon - exactly the access part 2 removes. Expose the
-- single yes/no answer instead of the table. SECURITY DEFINER = runs as the
-- function owner, returns only a boolean, leaks nothing else.

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
-- 4. field_options becomes a moderated queue
-- =============================================================================
-- Previously a student's free-typed "Other" answer could become a real dropdown
-- option in one click - that is how 'arts' and 'bsms' (lowercase) got in.
-- Now: submissions land as 'pending' and an admin merges/canonicalises/approves.

ALTER TABLE field_options
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS canonical_value TEXT,
  ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE field_options DROP CONSTRAINT IF EXISTS field_options_status_check;
ALTER TABLE field_options ADD CONSTRAINT field_options_status_check
  CHECK (status IN ('pending', 'approved'));

-- Stop the same (category, value) pair being queued twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_options_cat_value_lower
  ON field_options (category, lower(value));

ALTER TABLE field_options ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON field_options TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_options TO authenticated;

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
-- are not properly capitalised. Send them back through review.
-- The `canonical_value IS NULL` guard matters: without it, re-running this file
-- after an admin has approved them would silently demote them again and they
-- would vanish from the live dropdowns.
UPDATE field_options SET status = 'pending'
WHERE value IN ('arts', 'bsms')
  AND status = 'approved'
  AND canonical_value IS NULL;


-- =============================================================================
-- 5. organizations table (companies get the same treatment as colleges)
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

-- Grants and policies are INDEPENDENT gates: a policy cannot substitute for a
-- missing table grant. Supabase's default privileges usually cover new tables
-- in `public`, but stating it explicitly means this file does not depend on
-- that default still being in place.
GRANT SELECT ON organizations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO authenticated;

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

-- Link alumni to a verified organisation (kept alongside the free-text
-- currently_at, exactly like college_id sits alongside college_name_raw).
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alumni_organization_id ON alumni(organization_id);

-- Both admin "correct & link for all" flows write added_by_admin, so make sure
-- the column exists on colleges too. (It already does on the live database;
-- this is a no-op there and a safety net anywhere else.)
ALTER TABLE colleges ADD COLUMN IF NOT EXISTS added_by_admin BOOLEAN DEFAULT false;

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
-- 6. Official school names
-- =============================================================================
-- The form offered labels that no longer match how the schools are named, and
-- one default ('Veveaham Group Of Schools') matched no option at all.
--
-- Production data before this runs: 15 rows 'Veveaham Hr. Sec. School',
--                                    3 rows 'Veveaham Prime Academy',
--                                    1 row  'Veveaham Group Of Schools'.
--
-- Existing rows map to the GIRLS school. Boys/Girls was never a choice on the
-- old form, so no information is being destroyed here - there is nothing in the
-- database that distinguishes them. If you would rather these become the Boys
-- school, change the target string below before running (it appears once).

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
-- 7. Light data cleanup (safe, reviewed)
-- =============================================================================
-- Production holds 'Science' / 'Sciences' / 'science' as three different
-- fields, which splits the directory's category chips three ways.
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
-- field value 'kkk') are NOT deleted here. Use the Delete button in the admin
-- dashboard so the photo and the login account are cleaned up too.


-- =============================================================================
-- 8. Make everything visible to the REST API immediately
-- =============================================================================
-- Supabase ships an event trigger that reloads PostgREST's schema cache after
-- DDL, so this is usually redundant - but it is instant and harmless, and it
-- removes any doubt about whether the new view and function are queryable.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- 9. VERIFICATION — highlight each query and run it on its own
-- =============================================================================
-- (The editor only displays the result of the last statement in a paste.)

-- 9a. Expect TRUE. The view must not expose any contact column.
SELECT NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'public_alumni'
    AND column_name IN ('personal_email','phone_number','phone_country_code','admission_number')
) AS view_has_no_contact_columns;

-- 9b. Expect TRUE. The username RPC exists and is callable.
SELECT username_available('definitely_not_taken_zzz') AS rpc_works;

-- 9c. Expect only official names: Girls = 16, Prime Academy = 3.
SELECT school_name, count(*) FROM alumni GROUP BY school_name ORDER BY 2 DESC;

-- 9d. Expect 19 - the view must return the same people the directory shows.
SELECT count(*) AS approved_visible FROM public_alumni;

-- 9e. Expect pending = 2 (the 'arts' and 'bsms' values awaiting review).
SELECT status, count(*) FROM field_options GROUP BY status;

-- 9f. Expect 49 seeded organisations.
SELECT count(*) AS organizations_count FROM organizations;

-- 9g. Rehearse what an anonymous visitor can see through the view.
--     Expect 19. If this errors, the view's grant did not apply.
SET LOCAL ROLE anon;
SELECT count(*) AS anon_can_see FROM public_alumni;
RESET ROLE;


-- =============================================================================
-- ROLLBACK for this file (structural only; the data UPDATEs above are not undone)
-- =============================================================================
-- DROP VIEW IF EXISTS public_alumni;
-- DROP FUNCTION IF EXISTS username_available(TEXT);
-- ALTER TABLE field_options DISABLE ROW LEVEL SECURITY;
-- =============================================================================
