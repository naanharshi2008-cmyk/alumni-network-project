-- =============================================================================
-- Probe for migration 18, run in the Supabase SQL editor.
--
-- Paste migration 18 and then this file as one run. Everything happens inside
-- one transaction that ends by raising, so the new tables, the backfills, the
-- probe rows and every change below are rolled back. The raised message is
-- the result table.
--
-- It first prints what the backfill did to real rows - route mapping counts,
-- who leaves the directory - so the mapping can be checked before it is kept.
-- Then it acts as three people: an approved alumnus (a real one, borrowed and
-- rolled back), the school, and an anonymous visitor.
-- =============================================================================

DO $$
DECLARE
  uid      uuid;   -- the borrowed alumnus's login
  victim   uuid;   -- their profile
  staff    uuid;
  keeper   uuid;
  loser    uuid;
  att      uuid;
  n        int;
  m        int;
  txt      text;
  rec      record;
  before   public.alumni;
  after    public.alumni;
  r        text := E'\n';
BEGIN
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT user_id, id INTO uid, victim FROM public.alumni
   WHERE approval_status = 'approved' AND user_id IS NOT NULL
     AND consent_given IS NOT FALSE AND NOT in_gap_year
   ORDER BY created_at LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'No approved alumnus with a login to test with.'; END IF;

  -- ── What the backfill did ───────────────────────────────────────────────
  SELECT string_agg(tgname, ', ' ORDER BY tgname) INTO txt
    FROM pg_trigger WHERE tgrelid = 'public.alumni'::regclass AND NOT tgisinternal;
  r := r || 'note    triggers on alumni: ' || txt || E'\n';

  FOR rec IN
    SELECT coalesce(admission_route, '(none)') AS route,
           coalesce(admission_kind, '-') AS kind,
           coalesce(admission_exam, '-') AS exam,
           coalesce(admission_detail, '-') AS detail,
           count(*) AS n
      FROM public.alumni GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC, 1
  LOOP
    r := r || format('map     %-28s -> %-13s %-26s %-20s x%s', rec.route, rec.kind, rec.exam, rec.detail, rec.n) || E'\n';
  END LOOP;

  SELECT count(*) INTO n FROM public.alumni WHERE approval_status = 'approved' AND consent_given IS FALSE;
  r := r || format('note    %s approved profile(s) without consent leave the directory', n) || E'\n';
  SELECT count(*) INTO n FROM public.alumni WHERE origin = 'school';
  SELECT count(*) INTO m FROM public.alumni_office_notes;
  r := r || format('note    %s school-started profile(s); %s office note(s) moved to the private table', n, m) || E'\n';
  SELECT count(*) INTO n FROM public.alumni
   WHERE btrim(coalesce(linkedin_url, '')) <> '' AND linkedin_handle IS NULL;
  SELECT count(*) INTO m FROM public.alumni WHERE linkedin_handle IS NOT NULL;
  r := r || format('note    LinkedIn: %s username(s) read from links, %s link(s) that are not a /in/ profile', m, n) || E'\n';
  SELECT count(*) INTO n FROM public.alumni WHERE admission_kind = 'entrance_exam';
  SELECT count(*) INTO m FROM public.exam_attempts WHERE got_seat;
  r := r || CASE WHEN n = m THEN format('PASS  every entrance-exam profile has its seat attempt (%s)', n)
                 ELSE format('FAIL  %s entrance-exam profile(s), %s seat attempt(s)', n, m) END || E'\n';

  SELECT count(*) INTO n FROM public.public_alumni;
  SELECT count(*) INTO m FROM public.alumni WHERE public.alumnus_is_listed(id);
  r := r || CASE WHEN n = m THEN format('PASS  the view lists exactly the listed profiles (%s)', n)
                 ELSE format('FAIL  view %s, listing rule %s', n, m) END || E'\n';

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'public_alumni'
     AND column_name IN ('origin', 'import_key', 'import_batch_id', 'invited_by', 'in_gap_year');
  r := r || CASE WHEN n = 0 THEN 'PASS  no import or gap-year bookkeeping in public_alumni'
                 ELSE 'FAIL  bookkeeping columns leaked into public_alumni' END || E'\n';
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('public_exam_attempts', 'public_admits', 'public_gap_years', 'public_seats')
     AND column_name IN ('exam_rank', 'percentile', 'added_by_school');
  r := r || CASE WHEN n = 0 THEN 'PASS  no exact rank or percentile in the new public views'
                 ELSE 'FAIL  an exact score is in a public view' END || E'\n';

  SELECT string_agg(format('%s:%s', tablename, policyname), '; ' ORDER BY tablename, policyname) INTO txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('higher_studies', 'work_experience');
  r := r || 'note    timeline policies: ' || coalesce(txt, '(none)') || E'\n';

  -- ── The mapping and the helpers ─────────────────────────────────────────
  SELECT string_agg(format('%s=%s/%s/%s', v, coalesce(d.kind, '-'), coalesce(d.exam, '-'), coalesce(d.detail, '-')), '  ') INTO txt
    FROM unnest(ARRAY['Board Marks', 'Merit / Direct', 'TNEA', 'Management Quota', 'JEE', 'jee mains',
                      'NEET (AYUSH)', 'IISER', 'amritaeee', 'CA / CS / CMA Foundation', 'Sports Quota',
                      'Lateral Entry']) v
    CROSS JOIN LATERAL public.admission_from_route(v) d;
  r := r || 'note    ' || txt || E'\n';
  r := r || CASE WHEN (SELECT kind FROM public.admission_from_route('TNEA')) = 'board_marks'
                  AND (SELECT detail FROM public.admission_from_route('TNEA')) = 'TNEA'
                  AND (SELECT kind FROM public.admission_from_route('Management Quota')) = 'management'
                  AND (SELECT exam FROM public.admission_from_route('JEE')) = 'JEE Main'
                  AND (SELECT exam FROM public.admission_from_route('NEET (AYUSH)')) = 'NEET'
                  AND (SELECT exam FROM public.admission_from_route('iiser')) = 'IAT (IISER Aptitude Test)'
                  AND (SELECT kind FROM public.admission_from_route('CA / CS / CMA Foundation')) = 'other'
                  AND (SELECT kind FROM public.admission_from_route('Merit / Direct')) = 'board_marks'
                 THEN 'PASS  routes map as decided (TNEA is board marks, CA Foundation is not an exam)'
                 ELSE 'FAIL  a route maps the wrong way' END || E'\n';

  r := r || CASE WHEN public.rank_band_edge(1) = 100 AND public.rank_band_edge(100) = 100
                  AND public.rank_band_edge(101) = 500 AND public.rank_band_edge(4999) = 5000
                  AND public.rank_band_edge(100000) = 100000 AND public.rank_band_edge(100001) = 100001
                  AND public.rank_band_edge(0) IS NULL
                 THEN 'PASS  rank bands have the right edges' ELSE 'FAIL  rank bands' END || E'\n';
  r := r || CASE WHEN public.linkedin_handle_of('https://www.linkedin.com/in/Probe-Name-12/?utm_source=x') = 'probe-name-12'
                  AND public.linkedin_handle_of('linkedin.com/company/probe') IS NULL
                  AND public.linkedin_handle_of('in.linkedin.com/in/ab') IS NULL
                 THEN 'PASS  LinkedIn usernames are read from links' ELSE 'FAIL  LinkedIn parsing' END || E'\n';
  r := r || format('note    academic year now: %s', public.current_academic_year()) || E'\n';
  SELECT count(*) INTO n FROM public.field_options WHERE category = 'exam' AND lower(value) IN ('tnea', 'ca foundation');
  SELECT count(*) INTO m FROM public.field_options WHERE category = 'exam' AND canonical_value IS NULL AND areas IS NOT NULL;
  r := r || CASE WHEN n = 0 AND m >= 26 THEN format('PASS  %s exams seeded with areas; no TNEA, no CA Foundation', m)
                 ELSE format('FAIL  exam seed: %s canonical, %s forbidden', m, n) END || E'\n';
  SELECT count(*) INTO n FROM public.field_options WHERE category = 'branch' AND lower(value) IN ('cs', 'ca');
  r := r || CASE WHEN n = 0 AND public.option_column('branch') = 'branch'
                 THEN 'PASS  branches seeded; "CS" and "CA" left ambiguous on purpose'
                 ELSE 'FAIL  branch seed' END || E'\n';

  -- ── The derive trigger, as the SQL editor ───────────────────────────────
  SELECT * INTO before FROM public.alumni WHERE id = victim;
  UPDATE public.alumni SET admission_route = 'Management Quota' WHERE id = victim;
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.admission_kind = 'management' AND after.admission_exam IS NULL
                 THEN 'PASS  a legacy route alone sets the kind' ELSE 'FAIL  route -> kind: ' || coalesce(after.admission_kind, 'null') END || E'\n';
  UPDATE public.alumni SET admission_kind = 'entrance_exam', admission_exam = 'jee mains' WHERE id = victim;
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.admission_exam = 'JEE Main' AND after.admission_route = 'JEE Main'
                 THEN 'PASS  a kind sets the route label, and the exam is stored canonically'
                 ELSE format('FAIL  kind -> route: %s / %s', after.admission_exam, after.admission_route) END || E'\n';
  UPDATE public.alumni SET admission_kind = 'board_marks', admission_detail = 'TNEA' WHERE id = victim;
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.admission_exam IS NULL AND after.admission_route = 'TNEA'
                 THEN 'PASS  board marks through TNEA reads "TNEA" and clears the exam' ELSE 'FAIL  TNEA label' END || E'\n';
  UPDATE public.alumni SET linkedin_handle = 'ZZ-Probe-Handle' WHERE id = victim;
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.linkedin_handle = 'zz-probe-handle' AND after.linkedin_url = 'https://www.linkedin.com/in/zz-probe-handle'
                 THEN 'PASS  a username writes the link' ELSE 'FAIL  handle -> url' END || E'\n';
  UPDATE public.alumni SET linkedin_url = 'https://in.linkedin.com/in/zz-other-handle/' WHERE id = victim;
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.linkedin_handle = 'zz-other-handle'
                 THEN 'PASS  a link written the old way still yields the username' ELSE 'FAIL  url -> handle' END || E'\n';
  BEGIN
    UPDATE public.alumni SET admission_kind = 'entrance_exam', admission_exam = NULL WHERE id = victim;
    r := r || 'FAIL  an entrance exam with no exam was accepted' || E'\n';
  EXCEPTION WHEN check_violation THEN r := r || 'PASS  an entrance exam must name the exam' || E'\n'; END;

  -- ── Child rows, the listing rule, and bands ─────────────────────────────
  INSERT INTO public.exam_attempts (alumni_id, exam, exam_year, exam_rank, gave_admit)
  VALUES (victim, 'amrita eee', 2024, 1234, true) RETURNING id INTO att;
  SELECT exam INTO txt FROM public.exam_attempts WHERE id = att;
  r := r || CASE WHEN txt = 'AMRITAEEE' THEN 'PASS  an attempt is stored under the canonical exam'
                 ELSE 'FAIL  attempt exam stored as ' || coalesce(txt, 'null') END || E'\n';
  BEGIN
    INSERT INTO public.exam_attempts (alumni_id, exam, exam_year) VALUES (victim, 'AEEE', 2024);
    r := r || 'FAIL  the same exam twice in one year was accepted' || E'\n';
  EXCEPTION WHEN unique_violation THEN r := r || 'PASS  the same exam once a year' || E'\n'; END;
  SELECT rank_band_edge INTO n FROM public.public_exam_attempts WHERE id = att;
  r := r || CASE WHEN n = 5000 THEN 'PASS  the public view shows the band edge (5000), not the rank'
                 ELSE 'FAIL  public attempt band: ' || coalesce(n::text, 'missing') END || E'\n';

  INSERT INTO public.gap_years (alumni_id, gap_year, kind, exam) VALUES (victim, 2023, 'preparing', 'neet ug');
  UPDATE public.alumni SET in_gap_year = true WHERE id = victim;
  SELECT count(*) INTO n FROM public.public_alumni WHERE id = victim;
  SELECT count(*) INTO m FROM public.public_exam_attempts WHERE alumni_id = victim;
  r := r || CASE WHEN n = 0 AND m = 0 AND NOT public.is_approved_alumnus(victim)
                 THEN 'PASS  in a gap year: gone from the view, the attempts and the timeline rule'
                 ELSE format('FAIL  gap year still shows (view %s, attempts %s)', n, m) END || E'\n';
  UPDATE public.alumni SET in_gap_year = false WHERE id = victim;
  SELECT exam INTO txt FROM public.public_gap_years WHERE alumni_id = victim;
  r := r || CASE WHEN txt = 'NEET' THEN 'PASS  after it, the gap year shows on the timeline'
                 ELSE 'FAIL  past gap year: ' || coalesce(txt, 'missing') END || E'\n';

  -- ── Anonymous visitor ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  FOREACH txt IN ARRAY ARRAY['exam_attempts', 'admits', 'gap_years', 'alumni_private', 'alumni_office_notes', 'import_batches'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', txt) INTO n;
      r := r || format('FAIL  anon read %s (%s rows)', txt, n) || E'\n';
    EXCEPTION WHEN insufficient_privilege THEN r := r || format('PASS  anon refused on %s', txt) || E'\n'; END;
  END LOOP;
  BEGIN
    SELECT count(*) INTO n FROM public.public_exam_attempts;
    SELECT count(*) INTO n FROM public.public_admits;
    SELECT count(*) INTO n FROM public.public_gap_years;
    SELECT count(*) INTO n FROM public.public_seats;
    SELECT count(*) INTO n FROM public.public_alumni;
    SELECT count(*) INTO n FROM public.college_photos_public;
    r := r || 'PASS  anon reads the public views' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  anon on a public view: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.public_exam_attempts (alumni_id, exam) VALUES (victim, 'NEET');
    r := r || 'FAIL  anon wrote through a public view' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS  the public views are read-only' || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── The owner, while published ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', uid), true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO n FROM public.exam_attempts WHERE alumni_id = victim;
  r := r || CASE WHEN n >= 1 THEN 'PASS  the owner reads their own attempts' ELSE 'FAIL  owner cannot read own attempts' END || E'\n';
  BEGIN
    INSERT INTO public.exam_attempts (alumni_id, exam, exam_year) VALUES (victim, 'CUET', 2024);
    r := r || 'FAIL  a published owner wrote an attempt directly' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  published: attempts change only through review' || E'\n'; END;
  DELETE FROM public.exam_attempts WHERE alumni_id = victim;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN 'PASS  published: the owner cannot delete attempts' ELSE 'FAIL  owner deleted attempts' END || E'\n';

  UPDATE public.alumni SET origin = 'import', import_key = 'zz', invited_by = victim, school_note = 'zz',
                           admission_route = 'NEET', in_gap_year = false, consent_given = false
   WHERE id = victim;
  EXECUTE 'RESET ROLE';
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.origin = before.origin AND after.import_key IS NULL AND after.invited_by IS NULL
                  AND after.school_note IS NOT DISTINCT FROM before.school_note
                 THEN 'PASS  the owner cannot touch origin, import or invite fields'
                 ELSE 'FAIL  owner changed bookkeeping' END || E'\n';
  r := r || CASE WHEN after.admission_route = 'TNEA' THEN 'PASS  published: the route still waits for review'
                 ELSE 'FAIL  published route changed live' END || E'\n';
  SELECT count(*) INTO n FROM public.public_alumni WHERE id = victim;
  r := r || CASE WHEN after.consent_given = false AND n = 0
                 THEN 'PASS  withdrawing consent hides the profile at once'
                 ELSE 'FAIL  consent switch' END || E'\n';

  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.alumni SET consent_given = true, in_gap_year = true WHERE id = victim;
  EXECUTE 'RESET ROLE';
  SELECT * INTO after FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.consent_given AND after.in_gap_year
                 THEN 'PASS  consent back on; entering a gap year hides at once'
                 ELSE 'FAIL  consent on / gap year on' END || E'\n';
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.alumni SET in_gap_year = false WHERE id = victim;
  EXECUTE 'RESET ROLE';
  SELECT in_gap_year INTO after.in_gap_year FROM public.alumni WHERE id = victim;
  r := r || CASE WHEN after.in_gap_year THEN 'PASS  leaving a gap year waits for the school'
                 ELSE 'FAIL  the owner un-hid themselves' END || E'\n';
  UPDATE public.alumni SET in_gap_year = false WHERE id = victim;

  -- Family and home: live, at any state, and never the school's notes.
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.alumni_private (alumni_id, guardian1_name, guardian1_relation, guardian1_phone, town, pin, source)
    VALUES (victim, 'ZZ Probe Parent', 'Mother', '9000000000', 'ZZ Town', '638001', 'erp');
    SELECT source INTO txt FROM public.alumni_private WHERE alumni_id = victim;
    r := r || CASE WHEN txt = 'self' THEN 'PASS  the owner saves family and home live, stamped as their own'
                   ELSE 'FAIL  private source: ' || coalesce(txt, 'null') END || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  owner private write: ' || SQLERRM || E'\n'; END;
  DELETE FROM public.alumni_private WHERE alumni_id = victim;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 0 THEN 'PASS  only the school deletes family details' ELSE 'FAIL  owner deleted private row' END || E'\n';
  SELECT count(*) INTO n FROM public.alumni_office_notes;
  r := r || CASE WHEN n = 0 THEN 'PASS  office notes are invisible to the owner' ELSE 'FAIL  owner sees office notes' END || E'\n';
  BEGIN
    INSERT INTO public.alumni_office_notes (alumni_id, note) VALUES (victim, 'zz');
    r := r || 'FAIL  owner wrote an office note' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  office notes are the school''s alone' || E'\n'; END;
  EXECUTE 'RESET ROLE';

  -- ── The owner, before publishing ────────────────────────────────────────
  UPDATE public.alumni SET approval_status = 'pending' WHERE id = victim;
  INSERT INTO public.admits (alumni_id, college_name_raw, degree, added_by_school)
  VALUES (victim, 'ZZ Probe School-Added College', 'BTech', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.exam_attempts (alumni_id, exam, exam_year) VALUES (victim, 'CUET', 2024);
    INSERT INTO public.admits (alumni_id, college_name_raw, degree) VALUES (victim, 'ZZ Probe Own College', 'BSc');
    r := r || 'PASS  unpublished: the owner adds attempts and offers' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  unpublished owner write: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.admits (alumni_id, college_name_raw, added_by_school) VALUES (victim, 'ZZ Probe Fake', true);
    r := r || 'FAIL  the owner claimed an offer was school-added' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  only the school marks an offer as its own' || E'\n'; END;
  DELETE FROM public.admits WHERE alumni_id = victim;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO m FROM public.admits WHERE alumni_id = victim AND added_by_school;
  r := r || CASE WHEN n = 1 AND m = 1 THEN 'PASS  the owner removes their offers but not the school''s'
                 ELSE format('FAIL  owner deleted %s, school rows left %s', n, m) END || E'\n';
  EXECUTE 'RESET ROLE';

  -- ── The school ──────────────────────────────────────────────────────────
  UPDATE public.alumni SET consent_given = false WHERE id = victim;
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE public.alumni SET approval_status = 'approved' WHERE id = victim;
    r := r || 'FAIL  the school published a profile nobody agreed to' || E'\n';
  EXCEPTION WHEN check_violation THEN r := r || 'PASS  approval waits for consent' || E'\n'; END;
  SELECT count(*) INTO n FROM public.alumni_office_notes;
  r := r || format('PASS  the school reads office notes (%s)', n) || E'\n';
  BEGIN
    INSERT INTO public.alumni_private (alumni_id, town, source) VALUES (victim, 'ZZ', 'school')
    ON CONFLICT (alumni_id) DO UPDATE SET town = 'ZZ', source = 'school';
    SELECT source INTO txt FROM public.alumni_private WHERE alumni_id = victim;
    r := r || CASE WHEN txt = 'school' THEN 'PASS  the school writes family details, stamped as the school''s'
                   ELSE 'FAIL  school private source ' || coalesce(txt, 'null') END || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  school private write: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  UPDATE public.alumni SET consent_given = true, approval_status = 'approved' WHERE id = victim;

  -- Merging a college carries offers, and folds one that becomes a duplicate.
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Keeper College', 'Tamil Nadu') RETURNING id INTO keeper;
  INSERT INTO public.colleges (name, state) VALUES ('ZZ Probe Loser College', 'Tamil Nadu') RETURNING id INTO loser;
  INSERT INTO public.admits (alumni_id, college_id, degree, admit_year) VALUES (victim, keeper, 'BE', 2024);
  INSERT INTO public.admits (alumni_id, college_id, degree, admit_year) VALUES (victim, loser, 'BE', 2024);
  INSERT INTO public.admits (alumni_id, college_id, degree, admit_year) VALUES (victim, loser, 'BTech', 2024);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.merge_institute('college', loser, keeper);
    r := r || 'PASS  the school merges a college with offers at it' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  merge: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.admits WHERE college_id = keeper;
  SELECT count(*) INTO m FROM public.admits WHERE college_id = loser;
  r := r || CASE WHEN n = 2 AND m = 0 THEN 'PASS  offers moved to the survivor, the duplicate folded'
                 ELSE format('FAIL  after merge: %s at keeper, %s at loser', n, m) END || E'\n';
  SELECT count(*) INTO n FROM public.public_seats WHERE alumni_id = victim AND NOT joined;
  r := r || CASE WHEN n >= 2 THEN format('PASS  public_seats lists the offers not taken (%s)', n)
                 ELSE 'FAIL  public_seats offers: ' || n END || E'\n';

  RAISE EXCEPTION '%', r;
END
$$;
