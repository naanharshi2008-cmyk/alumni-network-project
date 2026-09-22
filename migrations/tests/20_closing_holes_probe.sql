-- =============================================================================
-- Probe for migration 20, run in the Supabase SQL editor.
--
-- Paste migration 20 and then this file as one run. Everything is rolled back
-- by the RAISE at the end.
-- =============================================================================

DO $$
DECLARE
  uid    uuid;
  victim uuid;
  other  uuid;
  staff  uuid;
  n      int;
  m      int;
  txt    text;
  r      text := E'\n';
BEGIN
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT user_id, id INTO uid, victim FROM public.alumni
   WHERE approval_status = 'approved' AND user_id IS NOT NULL AND consent_given IS NOT FALSE AND NOT in_gap_year
   ORDER BY created_at LIMIT 1;
  SELECT id INTO other FROM public.alumni WHERE approval_status = 'approved' AND id <> victim ORDER BY created_at LIMIT 1;

  -- ── The public view: bands, not numbers ─────────────────────────────────
  SELECT count(*) INTO n FROM public.public_alumni;
  SELECT count(*) INTO m FROM public.alumni WHERE public.alumnus_is_listed(id);
  r := r || CASE WHEN n = m THEN format('PASS  the view still lists everyone listed (%s)', n)
                 ELSE format('FAIL  view %s, listed %s', n, m) END || E'\n';
  SELECT count(*) INTO n FROM public.public_alumni v JOIN public.alumni a ON a.id = v.id
   WHERE a.admission_rank IS NOT NULL AND v.admission_rank = a.admission_rank
     AND public.rank_band_edge(regexp_replace(a.admission_rank, '\D', '', 'g')::int)::text <> a.admission_rank;
  r := r || CASE WHEN n = 0 THEN 'PASS  no exact rank is published' ELSE format('FAIL  %s exact rank(s) still public', n) END || E'\n';
  SELECT string_agg(DISTINCT v.admission_rank, ',') INTO txt FROM public.public_alumni v WHERE v.admission_rank IS NOT NULL;
  r := r || format('note    published rank values are now only band edges: %s', coalesce(txt, '(none)')) || E'\n';
  SELECT count(*) INTO n FROM public.public_alumni v JOIN public.alumni a ON a.id = v.id
   WHERE a.board_marks IS NOT NULL AND v.board_marks = a.board_marks AND a.board_marks !~ '^(0|50|60|70|80|85|90|95)$';
  r := r || CASE WHEN n = 0 THEN 'PASS  no exact marks are published' ELSE format('FAIL  %s exact mark(s) still public', n) END || E'\n';
  r := r || CASE WHEN public.marks_band_floor(95.42) = 95 AND public.marks_band_floor(92) = 90 AND public.marks_band_floor(87.5) = 85
                  AND public.marks_band_floor(81) = 80 AND public.marks_band_floor(76.4) = 70 AND public.marks_band_floor(49) = 0
                  AND public.marks_band_floor(101) IS NULL
                 THEN 'PASS  marks bands have the formatter''s edges' ELSE 'FAIL  marks bands' END || E'\n';

  -- ── The old timelines: owner writes only before publishing ──────────────
  INSERT INTO public.higher_studies (alumni_id, degree_name) VALUES (victim, 'ZZ Probe Degree');
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', uid), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.higher_studies WHERE alumni_id = victim AND degree_name = 'ZZ Probe Degree';
  r := r || CASE WHEN n = 1 THEN 'PASS  the owner reads their own studies' ELSE 'FAIL  owner cannot read own studies' END || E'\n';
  BEGIN
    INSERT INTO public.higher_studies (alumni_id, degree_name) VALUES (victim, 'ZZ Sneaky');
    r := r || 'FAIL  a published owner wrote a study directly' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  published: studies change only through review' || E'\n'; END;
  UPDATE public.higher_studies SET degree_name = 'ZZ Changed' WHERE alumni_id = victim AND degree_name = 'ZZ Probe Degree';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.work_experience WHERE alumni_id = victim;
  GET DIAGNOSTICS m = ROW_COUNT;
  r := r || CASE WHEN n = 0 AND m = 0 THEN 'PASS  published: nothing edited or removed directly' ELSE 'FAIL  published owner changed timelines' END || E'\n';
  EXECUTE 'RESET ROLE';

  UPDATE public.alumni SET approval_status = 'pending' WHERE id = victim;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.work_experience (alumni_id, company) VALUES (victim, 'ZZ Probe Co');
    UPDATE public.higher_studies SET degree_name = 'ZZ Changed' WHERE alumni_id = victim AND degree_name = 'ZZ Probe Degree';
    r := r || 'PASS  unpublished: the owner writes their timelines' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  unpublished owner write: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.alumni SET approval_status = 'approved' WHERE id = victim;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.higher_studies WHERE alumni_id = victim;
    r := r || format('PASS  anon still reads a listed person''s studies (%s)', n) || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  anon lost the timelines: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── Merging moves case variants ─────────────────────────────────────────
  UPDATE public.alumni SET degree = 'ZZ probedeg' WHERE id = victim;
  UPDATE public.alumni SET degree = 'zz PROBEDEG' WHERE id = other;
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.admin_merge_option('degree', ARRAY['zz probedeg'], 'ZZ ProbeDeg');
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.alumni WHERE id IN (victim, other) AND degree = 'ZZ ProbeDeg';
  r := r || CASE WHEN n = 2 THEN 'PASS  a correction of case alone moves every profile'
                 ELSE format('FAIL  case merge moved %s of 2', n) END || E'\n';

  RAISE EXCEPTION '%', r;
END
$$;
