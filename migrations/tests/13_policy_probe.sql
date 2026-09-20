-- =============================================================================
-- Probe for migration 13, run in the Supabase SQL editor.
--
-- Paste migration 13 and then this file, as one run. Every statement is inside
-- a single transaction and the probe ends by raising, so the tables, the
-- policies and the test photo are all rolled back: nothing here is kept. The
-- raised message is the result table.
--
-- It checks the part of 13 that is security, not shape: who may add a photo of
-- which college, who may approve one, and what a visitor can see.
-- =============================================================================

-- ── PROBE: exercise the policies as three different people, then abort ──────
DO $$
DECLARE
  uid uuid; aid uuid; own_college uuid; other_college uuid; pid uuid; n int;
  r text := E'\n';
BEGIN
  -- Whoever happens to be approved and linked to a college; no ids baked in.
  SELECT user_id, id, college_id INTO uid, aid, own_college
    FROM public.alumni
   WHERE approval_status = 'approved' AND college_id IS NOT NULL AND user_id IS NOT NULL
   LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'No approved alumnus with a college to test with.'; END IF;
  SELECT id INTO other_college FROM public.colleges
   WHERE merged_into IS NULL AND id IS DISTINCT FROM own_college LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'email', 'probe@veveaham-alumni-network.com')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    INSERT INTO public.college_photos (college_id, alumni_id, url, storage_path, caption)
    VALUES (own_college, aid, 'https://example/a.jpg', 'a.jpg', 'my campus') RETURNING id INTO pid;
    r := r || 'PASS  alumnus adds a photo of their own college' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  own-college insert: ' || SQLERRM || E'\n'; END;

  BEGIN
    INSERT INTO public.college_photos (college_id, alumni_id, url, storage_path)
    VALUES (other_college, aid, 'https://example/b.jpg', 'b.jpg');
    r := r || 'FAIL  a photo of a college they are NOT at was accepted' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: not their college' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  BEGIN
    INSERT INTO public.college_photos (college_id, alumni_id, url, storage_path, status)
    VALUES (own_college, aid, 'https://example/c.jpg', 'c.jpg', 'approved');
    r := r || 'FAIL  a self-approved photo was accepted' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: cannot self-approve' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  -- Row-level security answers an unauthorised UPDATE by matching no rows
  -- rather than raising, so the test is whether the row actually changed.
  BEGIN
    UPDATE public.college_photos SET status = 'approved' WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      r := r || 'PASS  their own photo cannot be self-approved (0 rows matched)' || E'\n';
    ELSE
      r := r || 'FAIL  alumnus approved their own pending photo' || E'\n';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: no update rights' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  SELECT count(*) INTO n FROM public.college_photos WHERE id = pid AND status = 'pending';
  r := r || CASE WHEN n = 1 THEN 'PASS  it is still pending afterwards' ELSE 'FAIL  status changed' END || E'\n';

  SELECT count(*) INTO n FROM public.college_photos WHERE id = pid;
  r := r || CASE WHEN n = 1 THEN 'PASS  they can see their own photo waiting' ELSE 'FAIL  own pending photo invisible' END || E'\n';

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM public.college_photos WHERE id = pid;
  r := r || CASE WHEN n = 0 THEN 'PASS  a visitor cannot see a pending photo' ELSE 'FAIL  pending photo is public' END || E'\n';
  SELECT count(*) INTO n FROM public.college_photos_public WHERE id = pid;
  r := r || CASE WHEN n = 0 THEN 'PASS  the public view excludes it too' ELSE 'FAIL  pending photo in public view' END || E'\n';

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '99999999-9999-9999-9999-999999999999', 'role', 'authenticated', 'email', 'staff@veveaham-admin.local')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.college_photos SET status = 'approved', reviewed_at = now() WHERE id = pid;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || CASE WHEN n = 1 THEN 'PASS  the school can approve it' ELSE 'FAIL  admin update changed nothing' END || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  admin approve: ' || SQLERRM || E'\n'; END;

  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM public.college_photos_public WHERE id = pid;
  r := r || CASE WHEN n = 1 THEN 'PASS  once approved, a visitor sees it with its credit' ELSE 'FAIL  approved photo not public' END || E'\n';

  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'public_alumni' AND column_name = 'email_verified_at';
  r := r || CASE WHEN n = 0 THEN 'PASS  email_verified_at is not exposed publicly' ELSE 'FAIL  verification time is public' END || E'\n';

  RAISE EXCEPTION 'PROBE RESULTS %(everything above was rolled back)', r;
END $$;
