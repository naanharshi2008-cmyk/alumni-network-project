-- =============================================================================
-- Probe: registration v4's writes, as the new person, rolled back.
--
-- Registration cannot be tried on the live site without creating a real
-- account, so this replays exactly what app/register/page.tsx sends after
-- signUp - the alumni row with the Round 10 columns, then the exam attempts,
-- offers, gap year and private row - as a signed-in person who is not the
-- school, and checks each lands. Ends by raising, so nothing is kept.
--
-- Borrows a login that has no profile (the staff account is one), with an
-- ordinary email in the claims, so is_school_admin() is false.
-- =============================================================================

DO $$
DECLARE
  who   uuid;
  me    uuid;
  slug  text;
  n     int;
  txt   text;
  r     text := E'\n';
BEGIN
  SELECT u.id INTO who FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.alumni a WHERE a.user_id = u.id)
   ORDER BY u.created_at LIMIT 1;
  IF who IS NULL THEN RAISE EXCEPTION 'No login without a profile to borrow.'; END IF;
  -- The share link's slug comes from the URL, not from a query the new
  -- person could run, so it is looked up here, before acting as them.
  SELECT public_slug INTO slug FROM public.alumni WHERE approval_status = 'approved' ORDER BY created_at LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"zz-probe@veveaham-alumni-network.com"}', who), true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 5. The profile row - the columns registration sends, in its shape.
  BEGIN
    INSERT INTO public.alumni (
      user_id, full_name, school_name, school_board, class_of, stream, show_photo, photo_url,
      personal_email, phone_country_code, phone_number, linkedin_handle,
      college_id, college_name_raw, professional_course, professional_stage, professional_org,
      degree, branch, field,
      admission_kind, admission_exam, admission_detail, admission_rank, board_marks, board_cutoff,
      in_gap_year, current_status, expected_finish_year, currently_at, organization_id, designation,
      message_1, consent_given, approval_status, modification_status)
    VALUES (
      who, 'ZZ Probe Registrant', 'Veveaham Matric HSS (Boys)', 'Matric / State Board', 2025, 'Computer Science (Maths)', false, NULL,
      'zz-probe-registrant@example.invalid', '+91', '9000000099', 'zz-probe-registrant',
      NULL, 'ZZ Probe College', NULL, NULL, NULL,
      'BE', 'Computer Science and Engineering', 'Engineering',
      'board_marks', NULL, 'TNEA', NULL, '96', '192.5',
      false, 'Studying UG', 2029, NULL, NULL, NULL,
      NULL, true, 'pending', 'none')
    RETURNING id INTO me;
    r := r || 'PASS  the profile row is accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || 'FAIL  profile insert: ' || SQLERRM || E'\n';
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION '%', r;
  END;

  -- 6b. The rest of the path, as the builders in lib/forms/model.ts make it.
  BEGIN
    INSERT INTO public.exam_attempts (alumni_id, exam, exam_year, exam_rank, gave_admit, got_seat)
    VALUES (me, 'JEE Main', 2025, 23456, true, false);
    r := r || 'PASS  exam attempts accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  attempts: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.admits (alumni_id, college_id, college_name_raw, degree, branch, route_kind, exam, route_detail, admit_year)
    VALUES (me, NULL, 'Amrita Coimbatore', 'BTech', 'Information Technology', 'entrance_exam', 'AMRITAEEE', NULL, 2025);
    r := r || 'PASS  offers accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  admits: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.gap_years (alumni_id, gap_year, kind, exam, coaching_name_raw)
    VALUES (me, 2025, 'preparing', 'NEET', 'Aakash Institute');
    r := r || 'PASS  gap year accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  gap_years: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.alumni_private (
      alumni_id, guardian1_name, guardian1_relation, guardian1_phone_code, guardian1_phone,
      guardian2_name, guardian2_relation, guardian2_phone_code, guardian2_phone,
      address_line, town, district, state, pin)
    VALUES (me, 'Zz Parent', 'Mother', '+91', '9000000008', NULL, NULL, NULL, NULL,
            '1 zz street', 'Erode', 'Erode', 'Tamil Nadu', '638001');
    r := r || 'PASS  family and home accepted' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  alumni_private: ' || SQLERRM || E'\n'; END;
  BEGIN
    PERFORM public.claim_invite(slug);
    r := r || 'PASS  the invite is recorded without error' || E'\n';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL  claim_invite: ' || SQLERRM || E'\n'; END;
  EXECUTE 'RESET ROLE';

  SELECT admission_route || ' / ' || coalesce(linkedin_url, '-') || ' / ' || origin || ' / ' || (invited_by IS NOT NULL)::text
    INTO txt FROM public.alumni WHERE id = me;
  r := r || CASE WHEN txt = 'TNEA / https://www.linkedin.com/in/zz-probe-registrant / self / true'
                 THEN 'PASS  the database labels the route, builds the link, marks it self-started and records the invite'
                 ELSE 'FAIL  derived: ' || coalesce(txt, 'null') END || E'\n';
  SELECT count(*) INTO n FROM public.public_alumni WHERE id = me;
  r := r || CASE WHEN n = 0 THEN 'PASS  pending, so not public' ELSE 'FAIL  a pending registration is public' END || E'\n';

  -- The same person entering a year out, before approval, as registration
  -- would send it: in_gap_year true.
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"zz-probe@veveaham-alumni-network.com"}', who), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.alumni SET in_gap_year = true, admission_kind = NULL, college_name_raw = NULL, degree = NULL WHERE id = me;
  EXECUTE 'RESET ROLE';
  SELECT (in_gap_year AND admission_route IS NULL)::text INTO txt FROM public.alumni WHERE id = me;
  r := r || CASE WHEN txt = 'true' THEN 'PASS  a year out with no seat saves, and clears the route label'
                 ELSE 'FAIL  gap-year save: ' || coalesce(txt, 'null') END || E'\n';

  RAISE EXCEPTION '%', r;
END
$$;
