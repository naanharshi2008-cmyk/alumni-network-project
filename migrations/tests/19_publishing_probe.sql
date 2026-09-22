-- =============================================================================
-- Probe for migration 19, run in the Supabase SQL editor.
--
-- Paste migration 19 and then this file as one run. It all happens inside one
-- transaction that ends by raising, so every probe row, publish, merge and
-- import below is rolled back. The raised message is the result table.
-- =============================================================================

DO $$
DECLARE
  uid      uuid;
  victim   uuid;
  vslug    text;
  vemail   text;
  other    uuid;
  oslug    text;
  staff    uuid;
  batch    uuid;
  ev       bigint;
  res      jsonb;
  n        int;
  m        int;
  txt      text;
  people   uuid[];
  orig     text;
  r        text := E'\n';
BEGIN
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT user_id, id, public_slug, personal_email INTO uid, victim, vslug, vemail FROM public.alumni
   WHERE approval_status = 'approved' AND user_id IS NOT NULL AND consent_given IS NOT FALSE AND NOT in_gap_year
   ORDER BY created_at LIMIT 1;
  SELECT id, public_slug INTO other, oslug FROM public.alumni
   WHERE approval_status = 'approved' AND id <> victim ORDER BY created_at LIMIT 1;
  IF uid IS NULL OR other IS NULL THEN RAISE EXCEPTION 'Need two approved alumni to test with.'; END IF;

  -- ── Shape ───────────────────────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'public' AND p.proname = 'admin_publish_changes';
  r := r || CASE WHEN n = 1 THEN 'PASS  one admin_publish_changes, so PostgREST cannot be confused'
                 ELSE format('FAIL  %s overloads of admin_publish_changes', n) END || E'\n';
  r := r || CASE WHEN 'admission_kind' = ANY(public.publishable_edit_columns())
                  AND 'in_gap_year' = ANY(public.publishable_edit_columns())
                  AND NOT ('origin' = ANY(public.publishable_edit_columns()))
                 THEN 'PASS  staged edits may carry the new columns, never the bookkeeping'
                 ELSE 'FAIL  publishable columns' END || E'\n';

  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);

  -- ── Publishing the lists, then undoing it ───────────────────────────────
  INSERT INTO public.admits (alumni_id, college_name_raw, degree, added_by_school)
  VALUES (victim, 'ZZ Probe School Offer', 'BE', true);
  UPDATE public.alumni
     SET modification_status = 'pending',
         pending_changes = jsonb_build_object(
           'admission_kind', 'board_marks', 'admission_detail', 'TNEA',
           'exam_attempts', jsonb_build_array(
              jsonb_build_object('exam', 'jee mains', 'exam_year', 2024, 'exam_rank', 1234, 'gave_admit', true),
              jsonb_build_object('exam', 'AEEE', 'exam_year', 2024, 'id', gen_random_uuid(), 'alumni_id', other)),
           'admits', jsonb_build_array(
              jsonb_build_object('college_name_raw', 'ZZ Probe Own Offer', 'degree', 'BTech', 'route_kind', 'entrance_exam',
                                 'exam', 'AEEE', 'added_by_school', true)),
           'gap_years', jsonb_build_array(jsonb_build_object('gap_year', 2023, 'kind', 'preparing', 'exam', 'NEET')))
   WHERE id = victim;
  SELECT count(*) INTO m FROM public.exam_attempts WHERE alumni_id = victim;
  SELECT concat_ws(' / ', admission_kind, coalesce(admission_exam, '-'), coalesce(admission_detail, '-'), admission_route)
    INTO orig FROM public.alumni WHERE id = victim;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    res := public.admin_publish_changes(victim, ARRAY['admission_kind', 'admission_detail'], false, false, NULL, true, true, true);
    r := r || 'PASS  the school publishes columns and lists in one call' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  publish: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  SELECT count(*) INTO n FROM public.exam_attempts WHERE alumni_id = victim AND exam IN ('JEE Main', 'AMRITAEEE');
  r := r || CASE WHEN n = 2 THEN 'PASS  attempts replaced, canonical names, a smuggled alumni_id ignored'
                 ELSE format('FAIL  attempts after publish: %s', n) END || E'\n';
  SELECT count(*) INTO n FROM public.exam_attempts WHERE alumni_id = other AND exam = 'AMRITAEEE' AND exam_year = 2024;
  r := r || CASE WHEN n = 0 THEN 'PASS  nothing written to anyone else''s profile' ELSE 'FAIL  a list wrote to another profile' END || E'\n';
  SELECT count(*) FILTER (WHERE added_by_school), count(*) FILTER (WHERE NOT added_by_school) INTO n, m
    FROM public.admits WHERE alumni_id = victim;
  r := r || CASE WHEN n = 1 AND m = 1 THEN 'PASS  the student''s offer published; the school''s kept; the flag not smuggled'
                 ELSE format('FAIL  admits: school %s, student %s', n, m) END || E'\n';
  SELECT admission_route INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = 'TNEA' THEN 'PASS  the published kind relabels the route' ELSE 'FAIL  route after publish: ' || coalesce(txt, 'null') END || E'\n';
  SELECT modification_status INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = 'none' THEN 'PASS  nothing left waiting' ELSE 'FAIL  still waiting: ' || txt END || E'\n';

  SELECT max(id) INTO ev FROM public.review_events WHERE alumni_id = victim AND action = 'publish';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_undo(ev);
    r := r || 'PASS  the school undoes the publish' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  undo: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.exam_attempts WHERE alumni_id = victim AND exam = 'JEE Main';
  SELECT count(*) INTO m FROM public.gap_years WHERE alumni_id = victim;
  SELECT concat_ws(' / ', admission_kind, coalesce(admission_exam, '-'), coalesce(admission_detail, '-'), admission_route)
    INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = orig
                 THEN 'PASS  undo restores the whole admission (' || txt || ')'
                 ELSE format('FAIL  admission after undo: %s, was %s', txt, orig) END || E'\n';
  r := r || CASE WHEN n = 0 AND m = 0 THEN 'PASS  undo puts the lists back as they were'
                 ELSE format('FAIL  after undo: %s JEE Main, %s gap years', n, m) END || E'\n';
  SELECT count(*) INTO n FROM public.admits WHERE alumni_id = victim AND added_by_school;
  r := r || CASE WHEN n = 1 THEN 'PASS  undo leaves the school''s offer alone' ELSE 'FAIL  undo touched the school''s offer' END || E'\n';

  -- The old five-argument call still lands.
  UPDATE public.alumni SET modification_status = 'pending', pending_changes = '{"message_2":"zz"}'::jsonb WHERE id = victim;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    res := public.admin_publish_changes(p_alumni_id => victim, p_keys => ARRAY['message_2'], p_studies => false, p_work => false, p_note => NULL);
    r := r || 'PASS  the old call shape still works' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  old call: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── Merging exams ───────────────────────────────────────────────────────
  INSERT INTO public.field_options (category, value, status, canonical_value, areas)
  VALUES ('exam', 'ZZ Canon', 'approved', NULL, ARRAY['engineering']),
         ('exam', 'ZZ Alias', 'approved', 'ZZ Canon', NULL),
         ('exam', 'ZZ Other', 'approved', NULL, ARRAY['sciences']);
  DELETE FROM public.exam_attempts WHERE alumni_id = victim;
  INSERT INTO public.exam_attempts (alumni_id, exam, exam_year, exam_rank, got_seat, gave_admit)
  VALUES (victim, 'ZZ Canon', 2024, NULL, true, true), (victim, 'ZZ Other', 2024, 777, false, NULL);
  UPDATE public.alumni SET admission_kind = 'entrance_exam', admission_exam = 'ZZ Canon',
         modification_status = 'pending',
         pending_changes = '{"exam_attempts":[{"exam":"ZZ Other","exam_year":2025}],"admission_exam":"zz other"}'::jsonb
   WHERE id = victim;

  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    -- Into what used to be an alias, and folding a second spelling in too.
    res := public.admin_merge_option('exam', ARRAY['ZZ Canon', 'ZZ Other'], 'ZZ Alias');
    r := r || format('PASS  exam merge ran: %s', res) || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  exam merge: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*), max(exam_rank), bool_or(got_seat) INTO n, m, txt FROM public.exam_attempts WHERE alumni_id = victim;
  r := r || CASE WHEN n = 1 AND m = 777 AND txt = 'true' THEN 'PASS  two attempts that became one exam were folded, keeping the rank and the seat'
                 ELSE format('FAIL  after fold: %s row(s), rank %s, seat %s', n, m, txt) END || E'\n';
  SELECT exam INTO txt FROM public.exam_attempts WHERE alumni_id = victim;
  r := r || CASE WHEN txt = 'ZZ Alias' THEN 'PASS  a merge into an old alias sticks (the trigger does not undo it)'
                 ELSE 'FAIL  attempt exam is ' || coalesce(txt, 'null') END || E'\n';
  SELECT admission_exam || ' / ' || admission_route INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = 'ZZ Alias / ZZ Alias' THEN 'PASS  the seat''s exam and its label follow'
                 ELSE 'FAIL  seat exam: ' || coalesce(txt, 'null') END || E'\n';
  SELECT pending_changes::text INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt LIKE '%ZZ Alias%' AND txt NOT LIKE '%ZZ Other%' AND txt NOT LIKE '%zz other%'
                 THEN 'PASS  staged lists and the staged exam are rewritten' ELSE 'FAIL  staged: ' || txt END || E'\n';
  SELECT (canonical_value IS NULL) AND areas @> ARRAY['engineering','sciences']::text[] INTO txt
    FROM public.field_options WHERE category = 'exam' AND value = 'ZZ Alias';
  SELECT count(*) INTO n FROM public.field_options WHERE category = 'exam' AND value IN ('ZZ Canon', 'ZZ Other') AND canonical_value = 'ZZ Alias';
  r := r || CASE WHEN txt = 'true' AND n = 2 THEN 'PASS  the survivor is canonical, keeps both areas; the others point at it'
                 ELSE format('FAIL  vocabulary after merge (%s, %s)', txt, n) END || E'\n';

  -- ── Merging branches reaches offers ─────────────────────────────────────
  INSERT INTO public.admits (alumni_id, college_name_raw, degree, branch) VALUES (victim, 'ZZ Probe Branch Offer', 'BE', 'zz branch x');
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    res := public.admin_merge_option('branch', ARRAY['ZZ Branch X'], 'ZZ Branch Y');
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  branch merge: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT branch INTO txt FROM public.admits WHERE alumni_id = victim AND college_name_raw = 'ZZ Probe Branch Offer';
  r := r || CASE WHEN txt = 'ZZ Branch Y' THEN 'PASS  a branch merge reaches the offers, whatever the case'
                 ELSE 'FAIL  offer branch: ' || coalesce(txt, 'null') END || E'\n';

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT uses INTO n FROM public.admin_option_usage() WHERE category = 'exam' AND value = 'ZZ Alias';
  EXECUTE 'RESET ROLE';
  r := r || CASE WHEN n = 1 THEN 'PASS  usage counts people, not rows' ELSE 'FAIL  usage: ' || coalesce(n::text, 'none') END || E'\n';

  -- ── Preparing again: per area, never below three ────────────────────────
  SELECT array_agg(id ORDER BY created_at) INTO people FROM (
    SELECT id, created_at FROM public.alumni WHERE approval_status = 'approved' AND consent_given IS NOT FALSE
     ORDER BY created_at LIMIT 3) s;
  IF cardinality(people) = 3 THEN
    INSERT INTO public.gap_years (alumni_id, gap_year, kind, exam)
    SELECT p, public.current_academic_year(), 'preparing', 'NEET' FROM unnest(people[1:2]) p
    ON CONFLICT (alumni_id, gap_year) DO UPDATE SET kind = 'preparing', exam = 'NEET';
    UPDATE public.alumni SET in_gap_year = true WHERE id = ANY(people[1:2]);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT count(*) INTO n FROM public.pathway_preparing_counts() WHERE area = 'medicine';
    EXECUTE 'RESET ROLE';
    INSERT INTO public.gap_years (alumni_id, gap_year, kind, exam)
    VALUES (people[3], public.current_academic_year(), 'preparing', 'NEET UG')
    ON CONFLICT (alumni_id, gap_year) DO UPDATE SET kind = 'preparing', exam = 'NEET';
    UPDATE public.alumni SET in_gap_year = true WHERE id = people[3];
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT preparing INTO m FROM public.pathway_preparing_counts() WHERE area = 'medicine';
    SELECT count(*) INTO txt FROM public.pathway_preparing_counts();
    EXECUTE 'RESET ROLE';
    r := r || CASE WHEN n = 0 AND m = 3 THEN format('PASS  two preparing is silent; three shows the area (%s area row(s))', txt)
                   ELSE format('FAIL  preparing counts: at two %s, at three %s', n, m) END || E'\n';
    UPDATE public.alumni SET in_gap_year = false WHERE id = ANY(people);
  ELSE
    r := r || 'SKIP  fewer than three approved profiles to count' || E'\n';
  END IF;

  -- ── Invitations ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT public.invite_card(oslug) ->> 'name' INTO txt;
  r := r || CASE WHEN txt IS NOT NULL THEN 'PASS  a share link names who sent it' ELSE 'FAIL  invite card empty' END || E'\n';
  SELECT public.invite_card(oslug) ? 'id' INTO txt;
  r := r || CASE WHEN txt = 'false' THEN 'PASS  the card carries no id' ELSE 'FAIL  invite card leaks the id' END || E'\n';
  BEGIN
    PERFORM public.claim_invite(oslug);
    r := r || 'FAIL  anon could call claim_invite' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  only a signed-in person records an invite' || E'\n'; END;
  BEGIN
    SELECT count(*) INTO n FROM public.claim_tokens;
    r := r || 'FAIL  anon read claim tokens' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  claim tokens are closed to anon' || E'\n'; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.alumni SET approval_status = 'rejected' WHERE id = other;
  SELECT public.invite_card(oslug) INTO res;
  r := r || CASE WHEN res IS NULL THEN 'PASS  a rejected profile invites nobody' ELSE 'FAIL  rejected inviter shown' END || E'\n';
  UPDATE public.alumni SET approval_status = 'approved' WHERE id = other;

  UPDATE public.alumni SET approval_status = 'pending', invited_by = NULL WHERE id = victim;
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', uid), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.claim_invite(oslug)::text INTO txt;
  SELECT public.claim_invite(vslug)::text INTO txt;  -- nobody invites themselves
  EXECUTE 'RESET ROLE';
  SELECT (invited_by = other)::text INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = 'true' THEN 'PASS  a new profile records who invited them, once'
                 ELSE 'FAIL  invited_by not recorded' END || E'\n';
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.claim_tokens;
  UPDATE public.alumni SET invited_by = NULL WHERE id = victim;
  EXECUTE 'RESET ROLE';
  SELECT (invited_by = other)::text INTO txt FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN txt = 'true' AND n = 0 THEN 'PASS  the owner can neither rewrite it nor see claim tokens'
                 ELSE 'FAIL  owner changed invited_by or saw tokens' END || E'\n';
  UPDATE public.alumni SET approval_status = 'approved' WHERE id = victim;

  -- ── Import ──────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.import_batches (file_name, class_of) VALUES ('zz-probe.csv', 2025) RETURNING id INTO batch;
  res := public.admin_import_rows(batch, jsonb_build_array(
    jsonb_build_object(
      'import_key', 'zz-probe-1', 'full_name', 'ZZ Probe Imported', 'class_of', 2025,
      'school_name', 'Veveaham Matric HSS (Boys)', 'stream', 'Computer Science (Maths)',
      'personal_email', 'zz-probe-import@example.invalid', 'phone_number', '9000000001',
      'college_name_raw', 'ZZ Probe College', 'degree', 'BE', 'branch', 'Computer Science and Engineering',
      'admission_kind', 'board_marks', 'admission_detail', 'TNEA',
      'private', jsonb_build_object('guardian1_name', 'ZZ Parent', 'guardian1_relation', 'Father',
                                    'guardian1_phone', '9000000002', 'town', 'ZZ Town', 'pin', '638001'),
      'office_note', 'from the probe',
      'exam_attempts', jsonb_build_array(jsonb_build_object('exam', 'JEE', 'exam_year', 2025)),
      'admits', jsonb_build_array(jsonb_build_object('college_name_raw', 'ZZ Probe Offer', 'degree', 'BTech')),
      'gap_years', '[]'::jsonb),
    jsonb_build_object('import_key', 'zz-probe-2', 'full_name', 'ZZ Probe Clash', 'class_of', 2025,
                       'personal_email', vemail),
    jsonb_build_object('import_key', 'zz-probe-3', 'full_name', '')));
  EXECUTE 'RESET ROLE';
  r := r || CASE WHEN (res ->> 'created')::int = 1
                  AND res -> 'rows' -> 0 ->> 'status' = 'created'
                  AND res -> 'rows' -> 1 ->> 'status' = 'error'
                  AND res -> 'rows' -> 2 ->> 'status' = 'error'
                 THEN format('PASS  import: one created, a clash and a blank reported (%s / %s)',
                             res -> 'rows' -> 1 ->> 'message', res -> 'rows' -> 2 ->> 'message')
                 ELSE 'FAIL  import result: ' || res::text END || E'\n';

  SELECT count(*) INTO n FROM public.alumni
   WHERE import_key = 'zz-probe-1' AND origin = 'import' AND consent_given = false
     AND approval_status = 'pending' AND user_id IS NULL AND admission_route = 'TNEA';
  SELECT count(*) INTO m FROM public.public_alumni WHERE full_name = 'ZZ Probe Imported';
  r := r || CASE WHEN n = 1 AND m = 0 THEN 'PASS  the imported profile is hidden, pending, unconsented, with no login'
                 ELSE format('FAIL  imported row (%s) or visible (%s)', n, m) END || E'\n';
  SELECT count(*) INTO n FROM public.alumni_private p JOIN public.alumni a ON a.id = p.alumni_id
   WHERE a.import_key = 'zz-probe-1' AND p.source = 'import' AND p.guardian1_relation = 'Father';
  SELECT count(*) INTO m FROM public.admits d JOIN public.alumni a ON a.id = d.alumni_id
   WHERE a.import_key = 'zz-probe-1' AND d.added_by_school;
  SELECT e.exam INTO txt FROM public.exam_attempts e JOIN public.alumni a ON a.id = e.alumni_id WHERE a.import_key = 'zz-probe-1';
  r := r || CASE WHEN n = 1 AND m = 1 AND txt = 'JEE Main'
                 THEN 'PASS  family, the school''s offer and a canonical attempt came with it'
                 ELSE format('FAIL  import children: private %s, offers %s, exam %s', n, m, txt) END || E'\n';

  EXECUTE 'SET LOCAL ROLE authenticated';
  res := public.admin_import_rows(batch, jsonb_build_array(
    jsonb_build_object('import_key', 'zz-probe-1', 'full_name', 'ZZ Probe Imported', 'class_of', 2025)));
  EXECUTE 'RESET ROLE';
  r := r || CASE WHEN res -> 'rows' -> 0 ->> 'status' = 'exists' AND (res ->> 'created')::int = 0
                 THEN 'PASS  the same row twice is "exists", not a second profile' ELSE 'FAIL  re-import: ' || res::text END || E'\n';

  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', uid), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    res := public.admin_import_rows(batch, '[]'::jsonb);
    r := r || 'FAIL  a non-admin imported' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS  only the school imports' || E'\n'; END;
  BEGIN
    res := public.admin_discard_import_batch(batch);
    r := r || 'FAIL  a non-admin discarded a batch' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS  only the school takes a batch back' || E'\n'; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.claim_tokens (alumni_id, token_hash, channel)
  SELECT id, repeat('ab', 32), 'email' FROM public.alumni WHERE import_key = 'zz-probe-1';
  res := public.admin_discard_import_batch(batch);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.alumni WHERE import_key = 'zz-probe-1';
  SELECT count(*) INTO m FROM public.claim_tokens WHERE token_hash = repeat('ab', 32);
  r := r || CASE WHEN (res ->> 'removed')::int = 1 AND n = 0 AND m = 0
                 THEN 'PASS  an unclaimed batch is taken back whole, its claim links with it'
                 ELSE 'FAIL  discard: ' || res::text END || E'\n';
  SELECT count(*) INTO n FROM public.review_events WHERE subject_kind = 'import';
  r := r || CASE WHEN n >= 1 THEN 'PASS  the log accepts import events' ELSE 'FAIL  no import event logged' END || E'\n';

  RAISE EXCEPTION '%', r;
END
$$;
