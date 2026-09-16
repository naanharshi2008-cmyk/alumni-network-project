-- =============================================================================
-- Veveaham Alumni - Migration 12: featured alumni
-- =============================================================================
-- The home page's Featured row and hero collage. The school stars profiles in
-- Admin -> All Alumni; the page puts starred profiles first, fills the rest
-- with the most complete profiles, and rotates the order every few hours.
--
-- Requires 10 (the view below carries 10's institute columns). Additive and
-- safe on the live site: the current code never reads these columns.
-- Paste the whole file into the Supabase SQL editor; it runs as one transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS featured_at timestamptz;


-- -----------------------------------------------------------------------------
-- Only the school features anyone.
-- -----------------------------------------------------------------------------
-- 07/08's guard already freezes every column of an APPROVED row for its owner,
-- but a pending row's owner can still write it, and could star themselves
-- before approval. This closes that, and stamps featured_at for admins.
CREATE OR REPLACE FUNCTION public.alumni_guard_featured()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.featured_at := CASE WHEN NEW.featured THEN coalesce(NEW.featured_at, now()) END;
    ELSIF NEW.featured IS DISTINCT FROM OLD.featured THEN
      NEW.featured_at := CASE WHEN NEW.featured THEN now() END;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.featured    := false;
    NEW.featured_at := NULL;
  ELSE
    NEW.featured    := OLD.featured;
    NEW.featured_at := OLD.featured_at;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS zz_alumni_guard_featured ON public.alumni;
CREATE TRIGGER zz_alumni_guard_featured
  BEFORE INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.alumni_guard_featured();


-- -----------------------------------------------------------------------------
-- public_alumni: 10's view plus `featured`
-- -----------------------------------------------------------------------------
-- STILL EXCLUDED: personal_email, phone_number, phone_country_code, email_key,
-- phone_key, admission_number, user_id, rejection_reason, pending_changes,
-- featured_at. Institute keys, merged_into and alias sources are not exposed.
DROP VIEW IF EXISTS public_alumni;

CREATE VIEW public_alumni AS
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

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: re-run the view block from 10; DROP TRIGGER zz_alumni_guard_featured
-- ON public.alumni; the two columns can stay (nothing reads them).
-- =============================================================================
