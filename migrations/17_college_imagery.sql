-- =============================================================================
-- Veveaham Alumni - Migration 17: colleges with faces
-- =============================================================================
-- `colleges.logo_url` has existed since migration 13 and has never been
-- readable by the site. The public view carries the college as one jsonb
-- object, and nobody added the key - so /colleges pays for a second query to
-- fetch logos and the directory shows none at all, while the column sits there
-- full of URLs the admin uploaded.
--
-- This adds it, and two columns for the other half of the round: a campus
-- photo one of our own seniors took can become that college's banner, with
-- their name under it.
--
-- The credit is a snapshot, not a join. It has to outlive the photo row and
-- the profile behind it, and reading it at display time would drag the alumni
-- table back into a public read path that migration 02 deliberately closed.
--
-- NOTE ON THE VIEW: the two new keys go INSIDE the existing `colleges` jsonb,
-- so the view's column list is unchanged. That matters - the site selects an
-- explicit column list and PostgREST answers 400 for the whole query when a
-- named column is missing, which takes the public site down rather than
-- degrading. Adding a key to a jsonb object cannot do that. Do not promote
-- either of these to a top-level view column.
--
-- Also fixes two bugs of the same age in merge_institute: it never carried
-- `logo_url` to the survivor, and it never moved `college_photos` at all, so
-- merging a duplicate orphaned every campus photo of the losing college.
--
-- REQUIRES 04 (banner_url), 10 (merge_institute), 12 (the view this rebuilds),
-- 13 (logo_url, college_photos).
-- Additive. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. Where a banner came from, and who took it
-- -----------------------------------------------------------------------------
ALTER TABLE public.colleges
  ADD COLUMN IF NOT EXISTS banner_credit   text,
  ADD COLUMN IF NOT EXISTS banner_photo_id uuid REFERENCES public.college_photos(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.colleges
    ADD CONSTRAINT colleges_banner_credit_len CHECK (char_length(banner_credit) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.colleges.banner_credit IS
  'Snapshot of who shared the photo now used as the banner. Deliberately not a join: it must survive the photo row and the profile.';
COMMENT ON COLUMN public.colleges.banner_photo_id IS
  'The college_photos row the banner was copied from, when it came from a student. ON DELETE SET NULL - deleting a photo must never delete a college.';


-- -----------------------------------------------------------------------------
-- 2. The public view learns the logo and the credit
-- -----------------------------------------------------------------------------
-- STILL EXCLUDED: personal_email, phone_number, phone_country_code, email_key,
-- phone_key, admission_number, user_id, rejection_reason, pending_changes,
-- review_note, featured_at. Institute keys, merged_into and alias sources are
-- not exposed. CREATE OR REPLACE rather than DROP + CREATE because no column
-- changes: there is no window where the view does not exist, and the grant
-- survives untouched.

CREATE OR REPLACE VIEW public_alumni AS
SELECT
  a.id,
  a.full_name,
  a.username,
  a.public_slug,
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
  a.organization_id,
  a.college_name_raw,
  a.created_at,
  a.last_updated,
  a.last_confirmed_at,
  a.school_note,
  a.college_thoughts,
  a.professional_course,
  a.professional_stage,
  a.professional_org,
  a.featured,
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
      'logo_url',         c.logo_url,
      'banner_credit',    c.banner_credit,
      'description',      c.description,
      'aliases',          coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                                    FROM institute_aliases ia WHERE ia.college_id = c.id), '[]'::jsonb)
    )
  END AS colleges,
  CASE WHEN o.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',    o.name,
      'aliases', coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                           FROM institute_aliases ia WHERE ia.organization_id = o.id), '[]'::jsonb)
    )
  END AS organization
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
LEFT JOIN organizations o ON o.id = a.organization_id
WHERE a.approval_status = 'approved';

GRANT SELECT ON public_alumni TO anon, authenticated;

COMMENT ON VIEW public_alumni IS
  'Public, privacy-safe projection of approved alumni. Contact details are intentionally absent. The site reads this instead of the alumni table.';


-- -----------------------------------------------------------------------------
-- 3. Merging a duplicate keeps its logo and its photos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_institute(p_kind text, p_from uuid, p_into uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid;
  moved_alumni int := 0;
  moved_staged int := 0;
BEGIN
  PERFORM public.assert_school_admin();
  IF p_kind NOT IN ('college', 'organization') THEN RAISE EXCEPTION 'Unknown institute kind.'; END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN RAISE EXCEPTION 'Pick two different institutes.'; END IF;

  IF p_kind = 'college' THEN
    SELECT coalesce(merged_into, id) INTO target FROM colleges WHERE id = p_into FOR UPDATE;
    IF target IS NULL THEN RAISE EXCEPTION 'The institute to keep no longer exists.'; END IF;
    PERFORM 1 FROM colleges WHERE id = p_from FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The duplicate no longer exists.'; END IF;
    IF target = p_from THEN RAISE EXCEPTION 'That institute is already merged the other way.'; END IF;

    UPDATE alumni SET college_id = target WHERE college_id = p_from;
    GET DIAGNOSTICS moved_alumni = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{college_id}', to_jsonb(target::text))
     WHERE pending_changes->>'college_id' = p_from::text;
    GET DIAGNOSTICS moved_staged = ROW_COUNT;

    DELETE FROM institute_aliases a
     WHERE a.college_id = p_from
       AND EXISTS (SELECT 1 FROM institute_aliases b WHERE b.college_id = target AND b.alias_key = a.alias_key);
    UPDATE institute_aliases SET college_id = target WHERE college_id = p_from;
    INSERT INTO institute_aliases (college_id, alias, source)
    SELECT target, f.name, 'merged' FROM colleges f, colleges t
     WHERE f.id = p_from AND t.id = target AND f.name_key <> t.name_key AND char_length(f.name_key) >= 2
    ON CONFLICT (entity_id, alias_key) DO NOTHING;

    -- Photos belong to the college, and the college is now the survivor.
    -- Without this a merge orphaned every approved campus photo of the loser.
    UPDATE college_photos SET college_id = target WHERE college_id = p_from;

    UPDATE colleges t
       SET banner_url  = coalesce(t.banner_url, f.banner_url),
           -- logo_url arrived in migration 13, after this function was written,
           -- so merging used to lose a logo silently.
           logo_url    = coalesce(t.logo_url, f.logo_url),
           description = coalesce(t.description, f.description),
           -- Credit travels WITH the banner, never on its own: coalescing it
           -- would put a student's name under a photograph they did not take.
           banner_credit   = CASE WHEN t.banner_url IS NULL THEN f.banner_credit   ELSE t.banner_credit   END,
           banner_photo_id = CASE WHEN t.banner_url IS NULL THEN f.banner_photo_id ELSE t.banner_photo_id END
      FROM colleges f WHERE t.id = target AND f.id = p_from;
    UPDATE colleges SET merged_into = target WHERE id = p_from OR merged_into = p_from;
  ELSE
    SELECT coalesce(merged_into, id) INTO target FROM organizations WHERE id = p_into FOR UPDATE;
    IF target IS NULL THEN RAISE EXCEPTION 'The organisation to keep no longer exists.'; END IF;
    PERFORM 1 FROM organizations WHERE id = p_from FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The duplicate no longer exists.'; END IF;
    IF target = p_from THEN RAISE EXCEPTION 'That organisation is already merged the other way.'; END IF;

    UPDATE alumni SET organization_id = target WHERE organization_id = p_from;
    GET DIAGNOSTICS moved_alumni = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{organization_id}', to_jsonb(target::text))
     WHERE pending_changes->>'organization_id' = p_from::text;
    GET DIAGNOSTICS moved_staged = ROW_COUNT;

    DELETE FROM institute_aliases a
     WHERE a.organization_id = p_from
       AND EXISTS (SELECT 1 FROM institute_aliases b WHERE b.organization_id = target AND b.alias_key = a.alias_key);
    UPDATE institute_aliases SET organization_id = target WHERE organization_id = p_from;
    INSERT INTO institute_aliases (organization_id, alias, source)
    SELECT target, f.name, 'merged' FROM organizations f, organizations t
     WHERE f.id = p_from AND t.id = target AND f.name_key <> t.name_key AND char_length(f.name_key) >= 2
    ON CONFLICT (entity_id, alias_key) DO NOTHING;
    UPDATE organizations SET merged_into = target WHERE id = p_from OR merged_into = p_from;
  END IF;

  RETURN jsonb_build_object('into', target, 'moved_alumni', moved_alumni, 'moved_staged_edits', moved_staged);
END
$$;


REVOKE ALL ON FUNCTION public.merge_institute(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_institute(text, uuid, uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. Which colleges still have no picture
-- -----------------------------------------------------------------------------
-- Driven from `alumni` grouped by college_id - a few hundred rows at any
-- realistic size - with `colleges` reached by primary key. The 47,000-row
-- table is probed, never scanned. The obvious alternative,
-- `SELECT ... FROM colleges WHERE banner_url IS NULL`, is both a sequential
-- scan and 47,000 rows that PostgREST truncates at a thousand without saying
-- so: the same trap that forced /colleges and /directory to derive their
-- lists from the alumni in the first place.
--
-- Colleges whose only students are still pending are included on purpose.
-- That is exactly when the school wants the imagery ready, so the directory
-- looks right the moment it approves them.
CREATE OR REPLACE FUNCTION public.admin_college_image_status()
RETURNS TABLE (
  id uuid, name text, state text, district text, website text,
  banner_url text, logo_url text, banner_credit text,
  students_approved int, students_pending int,
  photos_approved int, photos_pending int
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_school_admin();
  RETURN QUERY
  SELECT c.id, c.name, c.state, c.district, c.website,
         c.banner_url, c.logo_url, c.banner_credit,
         s.approved::int, s.pending::int,
         coalesce(p.approved, 0)::int, coalesce(p.pending, 0)::int
    FROM (SELECT college_id,
                 count(*) FILTER (WHERE approval_status = 'approved') AS approved,
                 count(*) FILTER (WHERE approval_status = 'pending')  AS pending
            FROM alumni WHERE college_id IS NOT NULL GROUP BY college_id) s
    JOIN colleges c ON c.id = s.college_id
    LEFT JOIN (SELECT college_id,
                      count(*) FILTER (WHERE status = 'approved') AS approved,
                      count(*) FILTER (WHERE status = 'pending')  AS pending
                 FROM college_photos GROUP BY college_id) p ON p.college_id = c.id
   -- Incomplete first, then the colleges most of our seniors are at.
   ORDER BY (c.banner_url IS NOT NULL AND c.logo_url IS NOT NULL), s.approved DESC, c.name;
END
$$;

REVOKE ALL ON FUNCTION public.admin_college_image_status() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_college_image_status() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK
--   DROP FUNCTION public.admin_college_image_status();
--   ALTER TABLE public.colleges
--     DROP COLUMN banner_credit, DROP COLUMN banner_photo_id;
--   Then restore public_alumni from migration 12 and merge_institute from
--   migration 10, IN THE SAME TRANSACTION as the column drops - both name the
--   dropped columns, and a view that references a missing column cannot be
--   replaced, only dropped and recreated.
-- =============================================================================
