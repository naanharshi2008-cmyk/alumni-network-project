-- =============================================================================
-- Veveaham Alumni - Migration 13: college photos, logos, and a confirmed email
-- =============================================================================
-- Two things the owner asked for in round 6:
--
--   1. /colleges shows gradient initials because no college has a banner, a
--      logo, or a single photograph. Admins get a logo alongside the banner,
--      and the students who are actually there can contribute campus photos -
--      each one waiting for the school to approve it, and credited to them.
--   2. A registration's email address is currently never proved. A typo means
--      a dead account: the welcome mail bounces and the reset link goes
--      nowhere. We send a link and record when it is used. Nothing blocks on
--      it - approval remains the gate - so registration still completes if
--      mail is down.
--
-- REQUIRES 07 (is_school_admin), 08 (public_slug) and 09/10 (college keys).
-- Additive: the current site keeps working. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. A confirmed email address
-- -----------------------------------------------------------------------------
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Tokens are stored hashed, so a leak of this table cannot verify anyone, and
-- the row dies with the profile. RLS on with NO policies: the service-role API
-- routes are the only reader and writer, exactly like auth_throttle in 08.
CREATE TABLE IF NOT EXISTS public.email_verifications (
  token_hash text PRIMARY KEY,
  alumni_id  uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  email_key  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS email_verifications_alumni_idx ON public.email_verifications (alumni_id);

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_verifications FROM anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. A logo for each institute
-- -----------------------------------------------------------------------------
-- Uploaded by an admin through the same route as the banner, into the same
-- bucket. Small, transparent, and shown over the banner on the college cards.
ALTER TABLE public.colleges ADD COLUMN IF NOT EXISTS logo_url text;


-- -----------------------------------------------------------------------------
-- 3. Photos, contributed by the students who are there
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.college_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id   uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  -- Kept when the profile goes, so an approved photo does not vanish from a
  -- college page; the credit simply stops naming anyone.
  alumni_id    uuid REFERENCES public.alumni(id) ON DELETE SET NULL,
  url          text NOT NULL,
  storage_path text NOT NULL,
  caption      text CHECK (char_length(caption) <= 160),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid
);

CREATE INDEX IF NOT EXISTS college_photos_college_idx ON public.college_photos (college_id, status);
CREATE INDEX IF NOT EXISTS college_photos_queue_idx ON public.college_photos (created_at) WHERE status = 'pending';

ALTER TABLE public.college_photos ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.college_photos TO anon, authenticated;
-- No UPDATE for anyone but an admin: approving a photo is the school's call,
-- and without the grant a student cannot flip their own row to 'approved'.
GRANT INSERT, DELETE ON public.college_photos TO authenticated;

DROP POLICY IF EXISTS "Approved photos are public" ON public.college_photos;
CREATE POLICY "Approved photos are public" ON public.college_photos
  FOR SELECT TO anon, authenticated
  USING (
    status = 'approved'
    OR public.is_school_admin()
    -- Your own submission, so you can see it waiting.
    OR alumni_id IN (SELECT id FROM public.alumni WHERE user_id = auth.uid())
  );

-- Only of the college you are actually at, only as an approved alumnus, and
-- only ever as 'pending'.
DROP POLICY IF EXISTS "Students add photos of their own college" ON public.college_photos;
CREATE POLICY "Students add photos of their own college" ON public.college_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND reviewed_at IS NULL
    AND alumni_id IN (
      SELECT id FROM public.alumni WHERE user_id = auth.uid() AND approval_status = 'approved'
    )
    AND college_id IN (
      SELECT college_id FROM public.alumni
      WHERE user_id = auth.uid() AND approval_status = 'approved' AND college_id IS NOT NULL
    )
  );

-- Changed your mind before the school looked at it.
DROP POLICY IF EXISTS "Students withdraw their own pending photo" ON public.college_photos;
CREATE POLICY "Students withdraw their own pending photo" ON public.college_photos
  FOR DELETE TO authenticated
  USING (
    status = 'pending'
    AND alumni_id IN (SELECT id FROM public.alumni WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage photos" ON public.college_photos;
CREATE POLICY "Admins manage photos" ON public.college_photos
  FOR ALL TO authenticated
  USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());


-- -----------------------------------------------------------------------------
-- 4. What the public page reads
-- -----------------------------------------------------------------------------
-- Approved photos with their credit already joined, so the gallery never has
-- to query the alumni table. A withdrawn or hidden profile simply stops being
-- named: the join carries approved profiles only.
CREATE OR REPLACE VIEW public.college_photos_public AS
SELECT
  p.id,
  p.college_id,
  p.url,
  p.caption,
  p.created_at,
  a.full_name   AS shared_by,
  a.public_slug AS shared_by_slug,
  a.class_of    AS shared_by_class
FROM public.college_photos p
LEFT JOIN public.alumni a
  ON a.id = p.alumni_id AND a.approval_status = 'approved'
WHERE p.status = 'approved';

GRANT SELECT ON public.college_photos_public TO anon, authenticated;

COMMENT ON VIEW public.college_photos_public IS
  'Approved college photos with the contributor''s public name. Pending and rejected photos are not visible here.';


-- -----------------------------------------------------------------------------
-- 5. The bucket
-- -----------------------------------------------------------------------------
-- Public for reads, with no storage policies: every write goes through the
-- service-role API route, which is the posture migration 04 argued for with
-- college-banners. If this INSERT raises "permission denied for table buckets",
-- create the bucket once in the Dashboard (public, 4 MB, jpeg/png/webp) and
-- re-run - the ON CONFLICT makes that safe.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('college-photos', 'college-photos', true, 4194304,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: DROP VIEW college_photos_public; DROP TABLE college_photos;
-- DROP TABLE email_verifications; ALTER TABLE colleges DROP COLUMN logo_url;
-- ALTER TABLE alumni DROP COLUMN email_verified_at. The bucket can stay.
-- =============================================================================
