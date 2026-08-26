-- =============================================================================
-- Veveaham Alumni — Migration v6: where a professional student actually is
-- =============================================================================
-- Additive, so it is safe to run while the site is live, and it MUST run
-- BEFORE the code that selects the new view column deploys (PostgREST 400s on
-- an unknown column, which takes the whole directory down).
--
-- Paste the whole file into the Supabase SQL editor: it runs as ONE
-- transaction, and the editor shows only the LAST statement's result.
-- Re-running is safe. Verification queries are COMMENTED at the bottom - run
-- them individually in a separate tab, never inside this paste.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The firm or institute behind a professional qualification
-- -----------------------------------------------------------------------------
-- Deliberately NOT the same as `currently_at`. Someone reading for CA alongside
-- a degree is "currently at" their college, while their articleship sits at an
-- audit firm; folding the two together loses whichever one is written second.
-- For a CA student with no college the two may well agree, and that is fine -
-- this field simply stays empty and `currently_at` carries it.
ALTER TABLE alumni
  ADD COLUMN IF NOT EXISTS professional_org TEXT;

COMMENT ON COLUMN alumni.professional_org IS
  'Where a professional qualification is being pursued - the articleship firm or coaching institute. Independent of currently_at, which is where the person is overall.';


-- -----------------------------------------------------------------------------
-- 2. Rebuild the public view
-- -----------------------------------------------------------------------------
-- Same DROP + CREATE + GRANT pattern as every previous migration (grants die
-- with the view, so they are restated).
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
  a.professional_org,
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
-- V1. Expect TRUE: the new column is in the view, contact columns are not.
--   SELECT
--     EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni' AND column_name = 'professional_org')
--     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_name = 'public_alumni'
--               AND column_name IN ('personal_email','phone_number','phone_country_code','admission_number'))
--     AS view_shape_ok;
--
-- V2. Expect the approved-profile count (19 at time of writing), unchanged.
--   SELECT count(*) FROM public_alumni;
--
-- V3. Anon rehearsal — expect the same count as V2.
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM public_alumni;
--
-- =============================================================================
-- ROLLBACK (structural): re-run the view block from 05_round4_additive.sql to
-- restore the previous shape. The column can stay - it is inert without the
-- code that reads it.
-- =============================================================================
