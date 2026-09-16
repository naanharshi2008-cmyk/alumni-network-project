-- =============================================================================
-- Veveaham Alumni — Migration 07: close the self-service holes, derive the board
-- =============================================================================
-- Found by probing production on 2026-09-16 with a throwaway account (since
-- deleted). Every statement below maps to one verified hole:
--
--   1. Any SIGNED-IN account could read every alumnus's personal_email and
--      phone_number (all 5 real rows, including 3 unapproved). The round-1 fix
--      closed this for anon only, and anyone can create an account.
--   2. ANONYMOUS visitors could INSERT into alumni and colleges.
--   3. A signed-in user could insert themselves already 'approved', or flip
--      their own approval_status later - bypassing admin review.
--   4. A signed-in user could write school_note on their own row: the public
--      "Note from Veveaham", i.e. impersonating the school.
--   5. Any signed-in account could INSERT colleges, which feed everyone's
--      type-ahead.
--
-- Why RESTRICTIVE policies: the existing permissive policies on alumni and
-- colleges were created outside this repo, so their names are unknown. A
-- restrictive policy is AND-ed with whatever permissive ones exist, so it
-- narrows access without having to find and drop them.
--
-- Safe to run while the current site is live: every app path that touches
-- these tables is an admin action, the signed-in person's own row, or a
-- service-role API route - all still allowed.
--
-- Paste the whole file into the Supabase SQL editor. It runs as ONE
-- transaction. Verification is done afterwards by probing the REST API.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helper: is the caller one of the school's admin accounts?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT coalesce(auth.email(), '') LIKE '%@veveaham-admin.local' $$;

GRANT EXECUTE ON FUNCTION public.is_school_admin() TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 1-4. alumni
-- -----------------------------------------------------------------------------
ALTER TABLE public.alumni ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors never write profiles: registration inserts only after
-- sign-up has returned a session. The public reads through public_alumni.
REVOKE INSERT, UPDATE, DELETE ON public.alumni FROM anon;

DROP POLICY IF EXISTS "r5 alumni: read own row or admin" ON public.alumni;
CREATE POLICY "r5 alumni: read own row or admin" ON public.alumni
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_school_admin());

DROP POLICY IF EXISTS "r5 alumni: insert own row or admin" ON public.alumni;
CREATE POLICY "r5 alumni: insert own row or admin" ON public.alumni
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_school_admin());

DROP POLICY IF EXISTS "r5 alumni: update own row or admin" ON public.alumni;
CREATE POLICY "r5 alumni: update own row or admin" ON public.alumni
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_school_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_school_admin());

-- Nothing in the app lets people delete their own profile; deletion goes
-- through the admin API route (service role), which bypasses RLS.
DROP POLICY IF EXISTS "r5 alumni: only admins delete" ON public.alumni;
CREATE POLICY "r5 alumni: only admins delete" ON public.alumni
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_school_admin());

-- Row-level policies cannot say "you may update your row but not THIS column",
-- so the field-level rules live in a trigger. It coerces rather than rejects:
-- a well-behaved client never sends these fields, and a tampered request
-- simply has them ignored.
CREATE OR REPLACE FUNCTION public.alumni_guard_self_service()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Trusted writers: admins in the dashboard, and anything that is not a
  -- PostgREST end-user role (the service-role API routes, the SQL editor,
  -- migrations).
  IF public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.user_id             := auth.uid();
    NEW.approval_status     := 'pending';
    NEW.modification_status := 'none';
    NEW.pending_changes     := NULL;
    NEW.rejection_reason    := NULL;
    NEW.school_note         := NULL;
    RETURN NEW;
  END IF;

  -- Only the school decides these, whatever the row's state.
  NEW.id               := OLD.id;
  NEW.user_id          := OLD.user_id;
  NEW.approval_status  := OLD.approval_status;
  NEW.rejection_reason := OLD.rejection_reason;
  NEW.school_note      := OLD.school_note;

  -- A published profile changes only through review. Its owner may stage
  -- edits, confirm the profile is still correct, and keep their private
  -- contact details current - and nothing else. Starting from OLD means any
  -- column added later is protected by default.
  IF OLD.approval_status = 'approved' THEN
    NEW := jsonb_populate_record(OLD, jsonb_build_object(
      'pending_changes',     NEW.pending_changes,
      'modification_status', CASE WHEN NEW.modification_status = 'pending'
                                  THEN 'pending' ELSE OLD.modification_status END,
      'last_confirmed_at',   NEW.last_confirmed_at,
      'personal_email',      NEW.personal_email,
      'phone_country_code',  NEW.phone_country_code,
      'phone_number',        NEW.phone_number
    ));
  END IF;

  RETURN NEW;
END
$$;

-- "zz_" so it fires after any other BEFORE trigger on the table (they run in
-- name order) and nothing can undo the guard.
DROP TRIGGER IF EXISTS zz_alumni_guard_self_service ON public.alumni;
CREATE TRIGGER zz_alumni_guard_self_service
  BEFORE INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.alumni_guard_self_service();


-- -----------------------------------------------------------------------------
-- 5. colleges: readable by everyone, written only by admins
-- -----------------------------------------------------------------------------
-- The public read policy is added in the same transaction as ENABLE, so the
-- type-ahead can never lose access even if RLS was previously off.
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.colleges FROM anon;

DROP POLICY IF EXISTS "r5 colleges: public read" ON public.colleges;
CREATE POLICY "r5 colleges: public read" ON public.colleges
  FOR SELECT TO anon, authenticated
  USING (true);

-- Permissive, so admins can write even where no older policy allowed it
-- (Phase 3 renames and merges run as the admin, not the service role).
DROP POLICY IF EXISTS "r5 colleges: admins manage" ON public.colleges;
CREATE POLICY "r5 colleges: admins manage" ON public.colleges
  FOR ALL TO authenticated
  USING (public.is_school_admin())
  WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "r5 colleges: only admins insert" ON public.colleges;
CREATE POLICY "r5 colleges: only admins insert" ON public.colleges
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "r5 colleges: only admins update" ON public.colleges;
CREATE POLICY "r5 colleges: only admins update" ON public.colleges
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_school_admin())
  WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "r5 colleges: only admins delete" ON public.colleges;
CREATE POLICY "r5 colleges: only admins delete" ON public.colleges
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_school_admin());


-- -----------------------------------------------------------------------------
-- 6. School board follows the school
-- -----------------------------------------------------------------------------
-- The registration form no longer asks for a board: the school decides it.
-- Boys (Matriculation) and Girls (State Board) are one merged board in
-- practice. This backfills rows written before that change.
UPDATE public.alumni
SET school_board = CASE school_name
  WHEN 'Veveaham Matric Higher Secondary School (Boys)' THEN 'Matric / State Board'
  WHEN 'Veveaham Higher Secondary School (Girls)'       THEN 'Matric / State Board'
  WHEN 'Veveaham Prime Academy'                         THEN 'CBSE'
  ELSE school_board
END
WHERE school_name IN (
  'Veveaham Matric Higher Secondary School (Boys)',
  'Veveaham Higher Secondary School (Girls)',
  'Veveaham Prime Academy'
);

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: DROP TRIGGER zz_alumni_guard_self_service ON public.alumni; then
-- DROP POLICY each "r5 …" policy above. The REVOKEs can be undone with GRANT,
-- but anonymous writes should stay closed.
-- =============================================================================
