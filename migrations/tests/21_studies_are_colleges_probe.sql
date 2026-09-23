-- =============================================================================
-- Probe for migration 21, run in the Supabase SQL editor.
--
-- Paste migration 21 and then this file as one run. It all happens inside one
-- transaction that ends by raising, so every row, publish, undo and merge
-- below is rolled back. The raised message is the result table.
-- =============================================================================

DO $$
DECLARE
  uid     uuid;
  victim  uuid;
  staff   uuid;
  keeper  uuid;
  loser   uuid;
  twinA   uuid;
  twinB   uuid;
  study   uuid;
  ev      bigint;
  n       int;
  m       int;
  txt     text;
  cid     uuid;
  r       text := E'\n';
BEGIN
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT user_id, id INTO uid, victim FROM public.alumni
   WHERE approval_status = 'approved' AND user_id IS NOT NULL AND consent_given IS NOT FALSE AND NOT in_gap_year
   ORDER BY created_at LIMIT 1;

  -- ── The column, as it was decided ───────────────────────────────────────
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'higher_studies'
     AND column_name = 'college_id' AND data_type = 'uuid' AND is_nullable = 'YES';
  r := r || CASE WHEN n = 1 THEN 'PASS  higher_studies.college_id is a nullable uuid'
                 ELSE 'FAIL  college_id missing, not uuid, or NOT NULL' END || E'\n';

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.higher_studies'::regclass AND contype = 'f' AND confdeltype = 'n'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                          WHERE attrelid = 'public.higher_studies'::regclass AND attname = 'college_id')];
  r := r || CASE WHEN n = 1 THEN 'PASS  deleting a college clears the link rather than the degree'
                 ELSE 'FAIL  the college_id foreign key is not ON DELETE SET NULL' END || E'\n';

  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'higher_studies_college_idx'
     AND indexdef LIKE '%WHERE (college_id IS NOT NULL)%';
  r := r || CASE WHEN n = 1 THEN 'PASS  the college index is partial' ELSE 'FAIL  partial index missing' END || E'\n';

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.higher_studies'::regclass AND tgname = 'higher_studies_follow_merges' AND NOT tgisinternal;
  r := r || CASE WHEN n = 1 THEN 'PASS  a study follows a merged college' ELSE 'FAIL  follow-merges trigger missing' END || E'\n';

  -- The decision itself: a degree with no institute named is still a fact.
  BEGIN
    INSERT INTO public.higher_studies (alumni_id, degree_name) VALUES (victim, 'ZZ Probe PhD');
    r := r || 'PASS  a degree with no institute named is still allowed' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  a nameless institute was refused: ' || SQLERRM || E'\n'; END;

  -- ── The backfill ────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM public.higher_studies WHERE college_id IS NOT NULL;
  SELECT count(*) INTO m FROM public.higher_studies
   WHERE college_id IS NULL AND btrim(coalesce(institution, '')) <> '';
  r := r || format('note    %s study row(s) now linked to a college; %s still text only', n, m) || E'\n';
  SELECT string_agg(DISTINCT institution, ' · ') INTO txt FROM (
    SELECT institution FROM public.higher_studies
     WHERE college_id IS NULL AND btrim(coalesce(institution, '')) <> '' LIMIT 5) s;
  r := r || format('note    for the office to link by hand: %s', coalesce(txt, '(none)')) || E'\n';

  SELECT count(*) INTO n FROM public.higher_studies h JOIN public.colleges c ON c.id = h.college_id
   WHERE c.merged_into IS NOT NULL;
  r := r || CASE WHEN n = 0 THEN 'PASS  no study points at a college that was merged away'
                 ELSE format('FAIL  %s study row(s) point at a merged college', n) END || E'\n';

  SELECT count(*) INTO n FROM public.higher_studies
   WHERE college_id IS NOT NULL AND public.resolve_institute('college', institution) IS DISTINCT FROM college_id;
  r := r || CASE WHEN n = 0 THEN 'PASS  every link the backfill made still resolves to itself'
                 ELSE format('FAIL  %s link(s) do not match resolve_institute', n) END || E'\n';

  -- Two colleges sharing a name: the backfill must decline, not guess.
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Twin College', 'Tamil Nadu') RETURNING id INTO twinA;
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Twin College', 'Kerala') RETURNING id INTO twinB;
  r := r || CASE WHEN public.resolve_institute('college', 'ZZ Probe Twin College') IS NULL
                 THEN 'PASS  an ambiguous name resolves to nothing rather than to one of them'
                 ELSE 'FAIL  an ambiguous name was resolved anyway' END || E'\n';

  -- ── The public view ─────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'public_higher_studies';
  r := r || CASE WHEN n = 1 THEN 'PASS  public_higher_studies exists' ELSE 'FAIL  the view is missing' END || E'\n';
  r := r || CASE WHEN has_table_privilege('anon', 'public.public_higher_studies', 'SELECT')
                 THEN 'PASS  anon may read the view' ELSE 'FAIL  anon cannot read the view' END || E'\n';

  SELECT count(*) INTO n FROM public.public_higher_studies;
  SELECT count(*) INTO m FROM public.higher_studies h WHERE public.alumnus_is_listed(h.alumni_id);
  r := r || CASE WHEN n = m THEN format('PASS  the view shows exactly the listed people''s studies (%s)', n)
                 ELSE format('FAIL  view %s, listed %s - the listing rule has drifted', n, m) END || E'\n';

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_higher_studies' AND column_name = 'created_at';
  r := r || CASE WHEN n = 0 THEN 'PASS  the view carries no bookkeeping' ELSE 'FAIL  created_at is published' END || E'\n';

  -- A gap year hides the person, and their degrees with them.
  SELECT count(*) INTO m FROM public.public_higher_studies WHERE alumni_id = victim;
  UPDATE public.alumni SET in_gap_year = true WHERE id = victim;
  SELECT count(*) INTO n FROM public.public_higher_studies WHERE alumni_id = victim;
  UPDATE public.alumni SET in_gap_year = false WHERE id = victim;
  r := r || CASE WHEN n = 0 THEN format('PASS  a year out takes their %s degree(s) out of the view with them', m)
                 ELSE format('FAIL  %s degree(s) still public during a gap year', n) END || E'\n';

  -- The embedded college, exactly when there is one.
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Keeper College', 'Tamil Nadu') RETURNING id INTO keeper;
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Loser College', 'Tamil Nadu') RETURNING id INTO loser;
  INSERT INTO public.higher_studies (alumni_id, degree_name, college_id, institution)
    VALUES (victim, 'ZZ Probe MSc', keeper, 'ZZ Probe Keeper College') RETURNING id INTO study;
  SELECT count(*) INTO n FROM public.public_higher_studies
   WHERE id = study AND college ->> 'name' = 'ZZ Probe Keeper College' AND jsonb_typeof(college -> 'aliases') = 'array';
  r := r || CASE WHEN n = 1 THEN 'PASS  a linked study carries its college, with an aliases array'
                 ELSE 'FAIL  the embedded college is missing or malformed' END || E'\n';
  SELECT count(*) INTO n FROM public.public_higher_studies v
    JOIN public.higher_studies h ON h.id = v.id
   WHERE (v.college IS NULL) <> (h.college_id IS NULL);
  r := r || CASE WHEN n = 0 THEN 'PASS  the college object is there exactly when the link is'
                 ELSE format('FAIL  %s row(s) disagree', n) END || E'\n';

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.public_higher_studies;
    r := r || format('PASS  anon reads the view (%s row(s))', n) || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  anon lost the view: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── The writer ──────────────────────────────────────────────────────────
  -- A smuggled id or alumni_id is dropped, not obeyed.
  SELECT id INTO cid FROM public.alumni WHERE id <> victim ORDER BY created_at LIMIT 1;
  PERFORM public.write_higher_studies(victim, jsonb_build_array(jsonb_build_object(
    'degree_name', 'ZZ Probe Smuggled', 'alumni_id', cid, 'id', gen_random_uuid())));
  SELECT count(*) INTO n FROM public.higher_studies WHERE alumni_id = cid AND degree_name = 'ZZ Probe Smuggled';
  SELECT count(*) INTO m FROM public.higher_studies WHERE alumni_id = victim AND degree_name = 'ZZ Probe Smuggled';
  r := r || CASE WHEN n = 0 AND m = 1 THEN 'PASS  the writer takes named columns only'
                 ELSE format('FAIL  smuggled row landed elsewhere (%s) or not at all (%s)', n, m) END || E'\n';

  -- A link with no text of its own borrows the college's name.
  PERFORM public.write_higher_studies(victim, jsonb_build_array(jsonb_build_object(
    'degree_name', 'ZZ Probe Borrowed', 'college_id', keeper)));
  SELECT institution INTO txt FROM public.higher_studies
   WHERE alumni_id = victim AND degree_name = 'ZZ Probe Borrowed';
  r := r || CASE WHEN txt = 'ZZ Probe Keeper College' THEN 'PASS  a linked row with no text takes the college''s name'
                 ELSE format('FAIL  institution came out as %s', coalesce(txt, 'null')) END || E'\n';

  -- ── Publishing and undoing keep the link ────────────────────────────────
  UPDATE public.alumni
     SET pending_changes = jsonb_build_object('higher_studies', jsonb_build_array(jsonb_build_object(
           'degree_name', 'ZZ Probe MTech', 'college_id', keeper, 'institution', 'ZZ Probe Keeper College',
           'start_year', 2026, 'finish_year', 2028))),
         modification_status = 'pending'
   WHERE id = victim;
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_publish_changes(victim, '{}', true, false, NULL);
    r := r || 'PASS  the school publishes a staged degree' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  publish: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  SELECT college_id INTO cid FROM public.higher_studies
   WHERE alumni_id = victim AND degree_name = 'ZZ Probe MTech';
  r := r || CASE WHEN cid = keeper THEN 'PASS  the published degree kept its college'
                 ELSE 'FAIL  publishing dropped the college link' END || E'\n';

  SELECT id INTO ev FROM public.review_events
   WHERE alumni_id = victim ORDER BY created_at DESC, id DESC LIMIT 1;
  SELECT count(*) INTO n FROM jsonb_array_elements(
    (SELECT before_state -> 'higher_studies' FROM public.review_events WHERE id = ev)) e
   WHERE e ? 'college_id';
  r := r || CASE WHEN n > 0 THEN 'PASS  the log remembers the link, so undo has it to put back'
                 ELSE 'FAIL  before_state carries no college_id' END || E'\n';

  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_undo(ev);
    r := r || 'PASS  the school undoes it' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  undo: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.higher_studies
   WHERE alumni_id = victim AND degree_name = 'ZZ Probe MSc' AND college_id = keeper;
  r := r || CASE WHEN n = 1 THEN 'PASS  undo restored the earlier degree with its college'
                 ELSE 'FAIL  undo lost the college link' END || E'\n';

  -- ── Merging ─────────────────────────────────────────────────────────────
  INSERT INTO public.higher_studies (alumni_id, degree_name, college_id, institution)
    VALUES (victim, 'ZZ Probe MBA', loser, 'ZZ Probe Loser College');
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.merge_institute('college', loser, keeper);
    r := r || 'PASS  the school merges a college someone studied at' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  merge: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.higher_studies WHERE college_id = loser;
  SELECT count(*) INTO m FROM public.higher_studies WHERE college_id = keeper AND degree_name = 'ZZ Probe MBA';
  r := r || CASE WHEN n = 0 AND m = 1 THEN 'PASS  the degree moved to the surviving college'
                 ELSE format('FAIL  %s left behind, %s moved', n, m) END || E'\n';

  -- And the trigger catches a link made after the merge.
  INSERT INTO public.higher_studies (alumni_id, degree_name, college_id, institution)
    VALUES (victim, 'ZZ Probe Late', loser, 'ZZ Probe Loser College') RETURNING college_id INTO cid;
  r := r || CASE WHEN cid = keeper THEN 'PASS  a link made after the merge lands on the survivor'
                 ELSE 'FAIL  a late link stayed on the merged-away college' END || E'\n';

  -- ── The overload guard ──────────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'admin_publish_changes';
  r := r || CASE WHEN n = 1 THEN 'PASS  exactly one admin_publish_changes (PostgREST can still choose)'
                 ELSE format('FAIL  %s copies of admin_publish_changes - PGRST203', n) END || E'\n';

  -- ── Migration 20's rule is still standing ───────────────────────────────
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', uid), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.higher_studies (alumni_id, degree_name, college_id) VALUES (victim, 'ZZ Sneaky', keeper);
    r := r || 'FAIL  a published owner wrote a degree directly' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS  published: degrees still change only through review' || E'\n'; END;
  EXECUTE 'RESET ROLE';

  UPDATE public.alumni SET approval_status = 'pending' WHERE id = victim;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.higher_studies (alumni_id, degree_name, college_id) VALUES (victim, 'ZZ Probe Own', keeper);
    r := r || 'PASS  unpublished: the owner writes their own degree, college and all' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  unpublished owner write: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.alumni SET approval_status = 'approved' WHERE id = victim;

  RAISE EXCEPTION '%', r;
END
$$;
