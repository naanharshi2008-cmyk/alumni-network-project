-- =============================================================================
-- Veveaham Alumni Network — Migration v4: professional qualifications (CA & co.)
-- =============================================================================
-- Everything here only ADDS, so it is safe to run while the current site is
-- live — and it MUST run BEFORE the round-4 code deploys, because that code
-- selects the new view columns (PostgREST 400s on unknown columns).
--
-- Paste the whole file into the Supabase SQL editor: it runs as ONE
-- transaction, and the editor shows only the LAST statement's result.
-- Re-running is safe. Verification queries are COMMENTED at the bottom — run
-- them individually in a separate tab, never inside this paste.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Professional qualification columns
-- -----------------------------------------------------------------------------
-- CA, CS, CMA and ACCA are not degrees and not colleges: you register with the
-- institute and clear levels. Crucially they are ADDITIVE rather than an
-- alternative path — plenty of students read for CA alongside a (often
-- distance) B.Com, and plenty do it on its own. So these are two independent
-- nullable columns rather than a path-type enum: a row can carry a college
-- degree, a professional course, both, or neither.
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS professional_course TEXT,
  ADD COLUMN IF NOT EXISTS professional_stage  TEXT;

COMMENT ON COLUMN alumni.professional_course IS
  'A professional qualification being read for or held (CA, CS, CMA, ACCA, or a free-typed value pending moderation). Independent of college/degree - the two coexist.';
COMMENT ON COLUMN alumni.professional_stage IS
  'How far along that qualification: Foundation, Intermediate, Articleship, Final, Qualified.';

-- No backfill: verified against production that no existing row uses CA, CS or
-- CMA as its `degree`, so there is nothing to migrate across. Those three are
-- being removed from the DEGREES list in the same release.


-- -----------------------------------------------------------------------------
-- 2. Rebuild the public view
-- -----------------------------------------------------------------------------
-- Same DROP + CREATE + GRANT pattern as previous migrations (grants die with
-- the view, so they are restated).
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
  a.professional_course,
  a.professional_stage,
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
-- V1. Expect TRUE: the new columns are in the view, contact columns are not.
--   SELECT
--     EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni' AND column_name = 'professional_course')
--     AND EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni' AND column_name = 'professional_stage')
--     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni'
--               AND column_name IN ('personal_email','phone_number','phone_country_code','admission_number'))
--     AS view_shape_ok;
--
-- V2. Expect the approved-profile count (19 at time of writing), unchanged.
--   SELECT count(*) FROM public_alumni;
--
-- V3. Expect 0 — confirms nothing needed backfilling out of `degree`.
--   SELECT count(*) FROM alumni WHERE degree IN ('CA', 'CS', 'CMA');
--
-- V4. Anon rehearsal — expect the same count as V2.
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public_alumni;
--
-- =============================================================================
-- ROLLBACK (structural): re-run the view block from 04_round3_additive.sql to
-- restore the previous shape. The two columns can stay — they are inert
-- without the round-4 code.
-- =============================================================================
