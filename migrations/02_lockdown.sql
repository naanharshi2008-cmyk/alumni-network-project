-- =============================================================================
-- Veveaham Alumni Network — Migration v2, PART 2 of 2: THE LOCKDOWN
-- =============================================================================
-- ⚠️  DO NOT RUN THIS UNTIL THE NEW CODE IS LIVE IN PRODUCTION.
--
-- This is the file that actually closes the privacy leak. It removes anonymous
-- access to the `alumni` table.
--
-- The code currently deployed reads that table directly with the public anon
-- key. If you run this before the new build is live, every visitor sees
-- "Couldn't load alumni: permission denied for table alumni" on the home page
-- and the directory, and registration fails at its first step.
--
-- CORRECT ORDER
--   1. Run migrations/01_additive.sql          (safe any time)
--   2. Deploy the new code and confirm it is live
--   3. Run THIS file
--   4. Run: npm run verify:security            (expect all checks to pass)
--
-- Re-running this file is safe.
-- =============================================================================


-- =============================================================================
-- 1. Helper: "is this alumnus approved?"  — READ THIS BEFORE EDITING
-- =============================================================================
-- The public profile cards show each person's study and work timeline, so
-- `higher_studies` and `work_experience` must stay readable by anonymous
-- visitors. Their old policy was `USING (true)`, which also published the
-- timelines of people who are still PENDING or were REJECTED - profiles the
-- directory deliberately hides. So the policy needs to check approval status.
--
-- The obvious way to write that check is a sub-select:
--
--     USING (alumni_id IN (SELECT id FROM alumni WHERE approval_status = 'approved'))
--
-- THAT IS A TRAP, and it is the reason this helper exists. PostgreSQL evaluates
-- a policy's USING expression with the privileges of the CALLING role. The
-- moment the REVOKE at the bottom of this file lands, that sub-select starts
-- failing for anon with "permission denied for table alumni" - so every public
-- timeline would disappear permanently, not just during a deploy window.
--
-- Routing the check through a SECURITY DEFINER function fixes it: the function
-- body runs as its owner, which can still read `alumni`.
--
-- The function is intentionally narrow: it takes a UUID the caller must already
-- possess and returns a single boolean. It is reachable at
-- POST /rest/v1/rpc/is_approved_alumnus, the same posture as the
-- username_available RPC. If you would rather it not be reachable at all,
-- create it in a schema that is not listed under Settings -> API -> Exposed
-- schemas and reference it by that qualified name in both policies below;
-- policy execution needs only EXECUTE on the function, not USAGE on its schema.

CREATE OR REPLACE FUNCTION public.is_approved_alumnus(a_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM alumni WHERE id = a_id AND approval_status = 'approved'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_approved_alumnus(UUID) TO anon, authenticated;


-- =============================================================================
-- 2. Scope the public timelines to approved alumni
-- =============================================================================
-- Both the old and the new policy names are dropped first so this file can be
-- re-run, and so it works whether or not an earlier draft was already applied.

GRANT SELECT ON higher_studies  TO anon, authenticated;
GRANT SELECT ON work_experience TO anon, authenticated;

DROP POLICY IF EXISTS "Higher studies are publicly viewable" ON higher_studies;
DROP POLICY IF EXISTS "Higher studies of approved alumni are public" ON higher_studies;
CREATE POLICY "Higher studies of approved alumni are public"
  ON higher_studies FOR SELECT
  TO anon, authenticated
  USING (public.is_approved_alumnus(alumni_id));

DROP POLICY IF EXISTS "Work experience is publicly viewable" ON work_experience;
DROP POLICY IF EXISTS "Work experience of approved alumni is public" ON work_experience;
CREATE POLICY "Work experience of approved alumni is public"
  ON work_experience FOR SELECT
  TO anon, authenticated
  USING (public.is_approved_alumnus(alumni_id));


-- =============================================================================
-- 3. Close the leak  — THIS MUST BE THE LAST STATEMENT
-- =============================================================================
-- SELECT only. INSERT stays, so registration keeps working. `authenticated`
-- keeps its SELECT because alumni need to read their own profile and admins
-- need the dashboard - both remain constrained by the existing RLS policies.
--
-- Do NOT "soften" this with a column-level grant such as
--   GRANT SELECT (id, approval_status) ON alumni TO anon;
-- It would make GET /alumni?select=id return 200 again and the verification
-- script's second check would correctly fail.

REVOKE SELECT ON alumni FROM anon;

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- 4. VERIFICATION — highlight each block and run it on its own
-- =============================================================================

-- 4a. Expect ZERO ROWS. This is the moment the leak is closed.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'alumni' AND grantee = 'anon' AND privilege_type = 'SELECT';

-- 4b. Expect 7. Public timelines must still be visible to anonymous visitors.
--     If this errors with "permission denied for table alumni", the policy in
--     section 2 did not apply - re-run this file.
SET LOCAL ROLE anon;
SELECT count(*) AS higher_studies_visible_to_anon FROM higher_studies;
RESET ROLE;

-- 4c. Expect 5.
SET LOCAL ROLE anon;
SELECT count(*) AS work_experience_visible_to_anon FROM work_experience;
RESET ROLE;

-- 4d. Expect 19. The directory must still work.
SET LOCAL ROLE anon;
SELECT count(*) AS approved_visible FROM public_alumni;
RESET ROLE;

-- 4e. Expect an ERROR: "permission denied for table alumni".
--     The error IS the pass condition. If it returns a number, the REVOKE
--     did not apply and contact details are still exposed.
SET LOCAL ROLE anon;
SELECT count(*) FROM alumni;
RESET ROLE;


-- =============================================================================
-- ROLLBACK — instant, restores service, and RE-OPENS THE LEAK
-- =============================================================================
-- Use only to buy time while you fix and redeploy, never as a resting state:
--
--   GRANT SELECT ON alumni TO anon;
-- =============================================================================
