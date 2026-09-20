-- =============================================================================
-- Probe for migration 17, run in the Supabase SQL editor.
--
-- Paste migration 17 and then this file as one run: everything happens inside
-- one transaction that ends by raising, so the two probe colleges, the photo
-- row and the merge are all rolled back.
-- =============================================================================

DO $$
DECLARE
  keeper uuid;
  -- review_events.actor_id references auth.users, so the staff account this
  -- probe pretends to be has to be a real login. What makes a caller the
  -- school is the email in the JWT claims, not the id, so any real id will
  -- do. It all rolls back either way.
  staff  uuid;
  loser  uuid;
  photo  uuid;
  res    jsonb;
  n      int;
  txt    text;
  r      text := E'\n';
BEGIN
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  IF staff IS NULL THEN RAISE EXCEPTION 'No logins to borrow an id from.'; END IF;

  -- ── The view carries the logo now ───────────────────────────────────────
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_alumni';
  r := r || format('note    public_alumni has %s columns', n) || E'\n';

  SELECT colleges ? 'logo_url' AND colleges ? 'banner_credit' INTO txt
    FROM public.public_alumni WHERE colleges IS NOT NULL LIMIT 1;
  r := r || CASE WHEN txt = 'true' THEN 'PASS  the college object carries logo_url and banner_credit'
                 WHEN txt IS NULL THEN 'SKIP  no approved profile is linked to a college yet'
                 ELSE 'FAIL  the new keys are missing from the view' END || E'\n';

  -- An anonymous visitor must still be able to read it.
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.public_alumni;
    r := r || format('PASS  anon still reads the view (%s approved profile(s))', n) || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  anon lost access to the view: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── Two colleges, one with imagery, one with a photo ────────────────────
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);

  INSERT INTO public.colleges (name, state, banner_url, banner_credit)
  VALUES ('ZZ Probe Keeper College', 'Tamil Nadu', 'https://example.com/keeper.jpg', NULL)
  RETURNING id INTO keeper;

  INSERT INTO public.colleges (name, state, banner_url, logo_url, banner_credit)
  VALUES ('ZZ Probe Loser College', 'Tamil Nadu',
          'https://example.com/loser.jpg', 'https://example.com/loser-logo.png', 'Photo by Someone Else ''22')
  RETURNING id INTO loser;

  INSERT INTO public.college_photos (college_id, url, storage_path, status, caption)
  VALUES (loser, 'https://example.com/photo.jpg', 'probe/photo.jpg', 'approved', 'ZZ probe photo')
  RETURNING id INTO photo;

  -- ── Merge ───────────────────────────────────────────────────────────────
  EXECUTE 'SET LOCAL ROLE authenticated';
  res := public.merge_institute('college', loser, keeper);
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  r := r || 'note    ' || res::text || E'\n';

  SELECT banner_url INTO txt FROM public.colleges WHERE id = keeper;
  r := r || CASE WHEN txt = 'https://example.com/keeper.jpg'
                 THEN 'PASS  the survivor kept its own banner' ELSE 'FAIL  banner changed to ' || coalesce(txt, 'null') END || E'\n';

  SELECT logo_url INTO txt FROM public.colleges WHERE id = keeper;
  r := r || CASE WHEN txt = 'https://example.com/loser-logo.png'
                 THEN 'PASS  the survivor inherited the logo it did not have'
                 ELSE 'FAIL  logo not carried over (' || coalesce(txt, 'null') || ')' END || E'\n';

  SELECT banner_credit INTO txt FROM public.colleges WHERE id = keeper;
  r := r || CASE WHEN txt IS NULL
                 THEN 'PASS  a credit did NOT detach from its banner and land on someone else''s'
                 ELSE 'FAIL  the survivor''s own banner is now credited to ' || txt END || E'\n';

  SELECT count(*) INTO n FROM public.college_photos WHERE id = photo AND college_id = keeper;
  r := r || CASE WHEN n = 1 THEN 'PASS  the campus photo moved to the survivor'
                 ELSE 'FAIL  the photo was orphaned by the merge' END || E'\n';

  -- ── A photo row may be deleted without taking the college with it ───────
  UPDATE public.colleges SET banner_photo_id = photo WHERE id = keeper;
  DELETE FROM public.college_photos WHERE id = photo;
  SELECT count(*) INTO n FROM public.colleges WHERE id = keeper;
  r := r || CASE WHEN n = 1 THEN 'PASS  deleting the source photo does not delete the college'
                 ELSE 'FAIL  the college went with the photo' END || E'\n';
  SELECT count(*) INTO n FROM public.colleges WHERE id = keeper AND banner_photo_id IS NULL;
  r := r || CASE WHEN n = 1 THEN 'PASS  the provenance is cleared rather than dangling'
                 ELSE 'FAIL  banner_photo_id still points at a deleted row' END || E'\n';

  -- ── The checklist ───────────────────────────────────────────────────────
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.admin_college_image_status();
  r := r || format('PASS  the checklist answers with %s college(s) our alumni are at', n) || E'\n';

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_college_image_status();
    r := r || 'FAIL  a non-admin read the checklist' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: the checklist is the school''s' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULTS %(everything above was rolled back)', r;
END $$;
