-- =============================================================================
-- Veveaham Alumni Network — Migration v3: freshness, banners, the school's voice
-- =============================================================================
-- Everything here only ADDS, so it is safe to run while the current site is
-- live — and it MUST run BEFORE the round-3 code deploys, because that code
-- selects the new view columns (PostgREST would 400 on unknown columns).
--
-- Paste the whole file into the Supabase SQL editor: it runs as ONE
-- transaction (any failure rolls the whole thing back), and the editor shows
-- only the LAST statement's result. Re-running is safe.
--
-- Verification queries are COMMENTED at the bottom — run them individually in
-- a separate tab, never together with this migration (learned the hard way:
-- one failing statement in the paste silently undoes the migration).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Freshness columns on alumni
-- -----------------------------------------------------------------------------
-- last_updated exists in production already (it predates this repo's
-- migrations); IF NOT EXISTS makes the file self-sufficient elsewhere.
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS last_updated      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS school_note       TEXT,
  ADD COLUMN IF NOT EXISTS college_thoughts  TEXT;

-- Inserts (registration) stamp themselves with the SERVER clock. Defaults do
-- not fire on UPDATE, so the app stamps updates explicitly.
ALTER TABLE alumni ALTER COLUMN last_updated SET DEFAULT now();
-- Registration counts as the first confirmation.
ALTER TABLE alumni ALTER COLUMN last_confirmed_at SET DEFAULT now();

COMMENT ON COLUMN alumni.last_updated IS
  'When the PUBLISHED profile content last changed: registration, an unapproved direct save, or an admin publishing staged edits. Admin hygiene ops (option merges, college linking) deliberately never bump this.';
COMMENT ON COLUMN alumni.last_confirmed_at IS
  'When the alumnus last attested the profile is correct: any save by them, or the one-tap "Everything is still correct" button.';
COMMENT ON COLUMN alumni.school_note IS
  'Optional note ABOUT the alumnus written by school staff (the "Note from Veveaham"). Admin-written only; never part of the profile editor or the staged-edit flow.';
COMMENT ON COLUMN alumni.college_thoughts IS
  'The alumnus''s own words about their college experience. Student-written in the profile editor; staged and reviewed like every other profile field.';

-- Backfill so the public "updated" line is never blank for existing rows.
-- last_confirmed_at is deliberately NOT backfilled: the UI hides the clause
-- when null, and an old row genuinely has no confirmation on record.
UPDATE alumni SET last_updated = created_at WHERE last_updated IS NULL;


-- -----------------------------------------------------------------------------
-- 2. College banner + description
-- -----------------------------------------------------------------------------
ALTER TABLE colleges
  ADD COLUMN IF NOT EXISTS banner_url  TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN colleges.banner_url IS
  'Public URL of the campus banner in the college-banners bucket. Written only by the admin API route using the service role.';
COMMENT ON COLUMN colleges.description IS
  'Short admin-written paragraph about the college, shown on the Explorer card and in profile modals. Written only via the admin API route.';


-- -----------------------------------------------------------------------------
-- 3. The banner bucket
-- -----------------------------------------------------------------------------
-- Public bucket with NO storage policies, on purpose: the only writer is the
-- service-role API route (which bypasses storage RLS), and a public bucket
-- serves reads without policies. anon/authenticated therefore cannot upload
-- here at all. The size/type limits below are enforced by storage itself, as
-- the last line of defence behind the client and route checks.
--
-- If this INSERT fails with "permission denied for table buckets" on this
-- project, create the bucket once in Dashboard -> Storage -> New bucket
-- (name: college-banners, Public ON), then re-run this file: the ON CONFLICT
-- makes it a no-op and everything else here is independent of it.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('college-banners', 'college-banners', true, 4194304,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 4. Rebuild the public view
-- -----------------------------------------------------------------------------
-- Same DROP + CREATE + GRANT pattern as 01_additive.sql (grants die with the
-- view, so they are restated). New this round: the four alumni columns after
-- created_at, and banner_url/description inside the colleges object.
--
-- STILL EXCLUDED, and verify:security depends on them staying out:
--   personal_email, phone_number, phone_country_code   <- the closed leak
--   admission_number, user_id, rejection_reason, original_data,
--   pending_changes, consent_given, modification_status

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
  CASE WHEN a.show_photo THEN a.photo_url ELSE NULL END AS photo_url,
  a.college_id,
  a.college_name_raw,
  a.created_at,
  a.last_updated,
  a.last_confirmed_at,
  a.school_note,
  a.college_thoughts,
  CASE WHEN c.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',             c.name,
      'state',            c.state,
      'district',         c.district,
      'website',          c.website,
      'university_name',  c.university_name,
      'management_type',  c.management_type,
      'established_year', c.established_year,
      'is_engineering',   c.is_engineering,
      'banner_url',       c.banner_url,
      'description',      c.description
    )
  END AS colleges
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
WHERE a.approval_status = 'approved';

GRANT SELECT ON public_alumni TO anon, authenticated;

COMMENT ON VIEW public_alumni IS
  'Public, privacy-safe projection of approved alumni. Contact details are intentionally absent. The site reads this instead of the alumni table.';

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION — run each query ON ITS OWN, in a separate editor tab.
-- =============================================================================
-- V1. Expect TRUE: new columns in the view, contact columns still absent.
--   SELECT
--     EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni' AND column_name = 'last_confirmed_at')
--     AND EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni' AND column_name = 'college_thoughts')
--     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni'
--               AND column_name IN ('personal_email','phone_number','phone_country_code','admission_number'))
--     AS view_shape_ok;
--
-- V2. Expect total = with_updated (no NULL last_updated after the backfill).
--   SELECT count(*) AS total, count(last_updated) AS with_updated FROM public_alumni;
--
-- V3. Expect one row: public bucket, 4MB cap.
--   SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'college-banners';
--
-- V4. Anon rehearsal — expect the approved-profile count (19 at time of writing).
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public_alumni;
--
-- =============================================================================
-- ROLLBACK (structural): re-run the view block from 01_additive.sql to restore
-- the previous view shape; ALTER TABLE alumni ALTER COLUMN last_updated DROP
-- DEFAULT; the new columns and the bucket can stay — they are inert without
-- the round-3 code.
-- =============================================================================
