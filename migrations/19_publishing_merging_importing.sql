-- =============================================================================
-- Veveaham Alumni - Migration 19: publishing, merging, counting, importing
-- =============================================================================
-- Migration 18 gave a path its shape. This teaches the school's tools about it:
--
--   * publishing an edit can replace the new lists - exams written, offers not
--     taken, gap years - in the same transaction as the columns, and undo can
--     put them back;
--   * merging two spellings of an exam reaches every table an exam lives in,
--     folding the duplicates a merge creates; a branch merge reaches offers;
--   * admin_option_usage() says where each value is used, in one read;
--   * pathway_preparing_counts() says how many are preparing again, per area,
--     never per exam and never below three;
--   * invite_card() lets a share link say who sent it; claim_invite() records
--     it on the new profile;
--   * claim_tokens holds the links that invite a student to a profile the
--     school started;
--   * admin_import_rows() creates hidden profiles from the school's sheet, a
--     few at a time and idempotently, and admin_discard_import_batch() undoes
--     a batch nobody has claimed yet.
--
-- REQUIRES 14 (admin_merge_option), 15 (review_events), 16 (publish / undo),
-- 18 (everything it names). One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. The log learns about imports and invitations
-- -----------------------------------------------------------------------------
ALTER TABLE public.review_events DROP CONSTRAINT IF EXISTS review_events_subject_kind_check;
ALTER TABLE public.review_events ADD CONSTRAINT review_events_subject_kind_check CHECK (subject_kind IN
  ('registration', 'profile_edit', 'profile', 'photo', 'option', 'institute', 'import'));
ALTER TABLE public.review_events DROP CONSTRAINT IF EXISTS review_events_action_check;
ALTER TABLE public.review_events ADD CONSTRAINT review_events_action_check CHECK (action IN
  ('approve', 'reject', 'publish', 'discard', 'hide', 'restore',
   'feature', 'unfeature', 'delete', 'link', 'merge', 'undo', 'import', 'invite'));


-- -----------------------------------------------------------------------------
-- 1b. The admin check for SECURITY DEFINER functions
-- -----------------------------------------------------------------------------
-- assert_school_admin() also trusts any role that is not anon or
-- authenticated - the SQL editor, migrations - by asking current_user. Inside
-- a SECURITY DEFINER function current_user is the function's owner, so that
-- test lets every caller through; this migration's probe caught exactly that.
-- Definer functions ask the token instead: the school's email, or the service
-- role's key, and nothing else.
CREATE OR REPLACE FUNCTION public.assert_school_admin_strict()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT (public.is_school_admin() OR coalesce(auth.jwt() ->> 'role', '') = 'service_role') THEN
    RAISE EXCEPTION 'Only school administrators can do this.' USING ERRCODE = '42501';
  END IF;
END
$$;


-- -----------------------------------------------------------------------------
-- 2. What a staged edit may touch - 16's list, plus 18's columns
-- -----------------------------------------------------------------------------
-- in_gap_year is here because leaving a gap year waits for review: the owner
-- stages false along with where they joined, and publishing lists them.
CREATE OR REPLACE FUNCTION public.publishable_edit_columns()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'full_name', 'school_name', 'school_board', 'admission_number', 'class_of', 'stream',
    'personal_email', 'phone_country_code', 'phone_number', 'linkedin_url',
    'college_id', 'college_name_raw', 'degree',
    'professional_course', 'professional_stage', 'professional_org',
    'branch', 'field', 'admission_route', 'admission_rank', 'board_marks', 'board_cutoff',
    'current_status', 'expected_finish_year', 'currently_at', 'organization_id', 'designation',
    'message_1', 'message_2', 'college_thoughts', 'photo_url', 'show_photo', 'consent_given',
    'admission_kind', 'admission_exam', 'admission_detail', 'linkedin_handle', 'in_gap_year'
  ]::text[]
$$;


-- -----------------------------------------------------------------------------
-- 3. The lists, written from JSON - one place, for publish, undo and import
-- -----------------------------------------------------------------------------
-- Named columns only, so an id, an alumni_id or an added_by_school smuggled
-- into an entry is dropped. The seat is inserted first, so if a list somehow
-- carries the same exam twice in a year it is the seat that survives.
CREATE OR REPLACE FUNCTION public.write_exam_attempts(p_alumni_id uuid, p_list jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  INSERT INTO public.exam_attempts (alumni_id, exam, exam_year, exam_rank, percentile, gave_admit, got_seat)
  SELECT p_alumni_id, x.exam, x.exam_year, nullif(x.exam_rank, 0), x.percentile,
         CASE WHEN coalesce(x.got_seat, false) THEN true ELSE x.gave_admit END, coalesce(x.got_seat, false)
    FROM jsonb_to_recordset(p_list)
      AS x(exam text, exam_year int, exam_rank int, percentile numeric, gave_admit boolean, got_seat boolean)
   WHERE btrim(coalesce(x.exam, '')) <> ''
   ORDER BY coalesce(x.got_seat, false) DESC
  ON CONFLICT DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION public.write_admits(p_alumni_id uuid, p_list jsonb, p_by_school boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  INSERT INTO public.admits (alumni_id, college_id, college_name_raw, degree, branch,
                             route_kind, exam, route_detail, admit_year, added_by_school)
  SELECT p_alumni_id, x.college_id, nullif(btrim(x.college_name_raw), ''), nullif(btrim(x.degree), ''),
         nullif(btrim(x.branch), ''), x.route_kind,
         CASE WHEN x.route_kind = 'entrance_exam' THEN nullif(btrim(x.exam), '') END,
         nullif(btrim(x.route_detail), ''), x.admit_year, p_by_school
    FROM jsonb_to_recordset(p_list)
      AS x(college_id uuid, college_name_raw text, degree text, branch text, route_kind text,
           exam text, route_detail text, admit_year int)
   WHERE x.college_id IS NOT NULL OR btrim(coalesce(x.college_name_raw, '')) <> ''
  ON CONFLICT DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION public.write_gap_years(p_alumni_id uuid, p_list jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  INSERT INTO public.gap_years (alumni_id, gap_year, kind, exam, coaching_name_raw, coaching_org_id)
  SELECT p_alumni_id, x.gap_year, coalesce(x.kind, 'preparing'),
         CASE WHEN coalesce(x.kind, 'preparing') = 'preparing' THEN nullif(btrim(x.exam), '') END,
         CASE WHEN coalesce(x.kind, 'preparing') = 'preparing' THEN nullif(btrim(x.coaching_name_raw), '') END,
         CASE WHEN coalesce(x.kind, 'preparing') = 'preparing' THEN x.coaching_org_id END
    FROM jsonb_to_recordset(p_list)
      AS x(gap_year int, kind text, exam text, coaching_name_raw text, coaching_org_id uuid)
   WHERE x.gap_year IS NOT NULL
  ON CONFLICT DO NOTHING;
END
$$;

-- The lists as they stand, in the same shape, for the log's before_state.
CREATE OR REPLACE FUNCTION public.read_path_lists(p_alumni_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'exam_attempts', (SELECT coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'alumni_id' - 'created_at' ORDER BY e.got_seat DESC, e.exam), '[]'::jsonb)
                        FROM public.exam_attempts e WHERE e.alumni_id = p_alumni_id),
    'admits',        (SELECT coalesce(jsonb_agg(to_jsonb(d) - 'id' - 'alumni_id' - 'created_at' - 'added_by_school' ORDER BY d.created_at), '[]'::jsonb)
                        FROM public.admits d WHERE d.alumni_id = p_alumni_id AND NOT d.added_by_school),
    'gap_years',     (SELECT coalesce(jsonb_agg(to_jsonb(g) - 'id' - 'alumni_id' - 'created_at' ORDER BY g.gap_year), '[]'::jsonb)
                        FROM public.gap_years g WHERE g.alumni_id = p_alumni_id))
$$;

-- SECURITY INVOKER, so they grant nothing: called directly, every row still
-- meets the caller's own policies (an owner cannot mark an offer the school's,
-- nor write to a published profile). The admin functions below call them as
-- the school; the import calls them as its definer. Anon has no use for them.
REVOKE ALL ON FUNCTION public.write_exam_attempts(uuid, jsonb), public.write_admits(uuid, jsonb, boolean),
                       public.write_gap_years(uuid, jsonb), public.read_path_lists(uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.write_exam_attempts(uuid, jsonb), public.write_admits(uuid, jsonb, boolean),
                          public.write_gap_years(uuid, jsonb), public.read_path_lists(uuid)
  TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. Publish some of it - now with the lists
-- -----------------------------------------------------------------------------
-- The old five-argument signature is dropped first: PostgREST cannot choose
-- between two overloads (PGRST203), and the new one answers every call the old
-- one did, because the three new arguments default to false.
DROP FUNCTION IF EXISTS public.admin_publish_changes(uuid, text[], boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_publish_changes(
  p_alumni_id uuid,
  p_keys      text[],
  p_studies   boolean DEFAULT false,
  p_work      boolean DEFAULT false,
  p_note      text DEFAULT NULL,
  p_attempts  boolean DEFAULT false,
  p_admits    boolean DEFAULT false,
  p_gap_years boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  a         public.alumni;
  staged    jsonb;
  keys      text[];
  refused   text[];
  patched   jsonb;
  before    jsonb := '{}'::jsonb;
  lists     jsonb;
  remainder jsonb;
  set_sql   text;
  did       boolean;
  n_lists   int;
  note      text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  PERFORM public.assert_school_admin();

  SELECT * INTO a FROM public.alumni WHERE id = p_alumni_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That profile no longer exists.'; END IF;
  IF a.modification_status <> 'pending' THEN
    RAISE EXCEPTION 'There is nothing waiting for review on that profile.';
  END IF;

  staged := coalesce(a.pending_changes, '{}'::jsonb);

  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO keys
    FROM unnest(coalesce(p_keys, '{}'::text[])) k
   WHERE staged ? k AND k = ANY(public.publishable_edit_columns());

  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO refused
    FROM unnest(coalesce(p_keys, '{}'::text[])) k
   WHERE NOT (k = ANY(keys));

  IF cardinality(keys) > 0 THEN
    -- The old values, so this can be undone - and for the admission and
    -- LinkedIn columns, the whole group. They are kept in step by a trigger,
    -- so publishing a kind can clear the exam: undo must put back all of it,
    -- or it would be putting back an entrance exam with no exam.
    SELECT jsonb_object_agg(k, to_jsonb(a) -> k) INTO before
      FROM (SELECT DISTINCT k FROM unnest(keys
              || CASE WHEN keys && ARRAY['admission_kind', 'admission_exam', 'admission_detail', 'admission_route']
                      THEN ARRAY['admission_kind', 'admission_exam', 'admission_detail', 'admission_route'] ELSE '{}'::text[] END
              || CASE WHEN keys && ARRAY['linkedin_url', 'linkedin_handle']
                      THEN ARRAY['linkedin_url', 'linkedin_handle'] ELSE '{}'::text[] END) k) ks;
    patched := (SELECT jsonb_object_agg(k, staged -> k) FROM unnest(keys) k);
    set_sql := (SELECT string_agg(format('%I = p.%I', k, k), ', ') FROM unnest(keys) k);
    BEGIN
      EXECUTE format(
        'UPDATE public.alumni a SET %s FROM jsonb_populate_record(NULL::public.alumni, $1) p WHERE a.id = $2',
        set_sql)
      USING patched, p_alumni_id;
    EXCEPTION
      WHEN invalid_text_representation OR datatype_mismatch THEN
        RAISE EXCEPTION 'One of the staged values is not the right kind of thing for its field (%). Nothing was published.', SQLERRM;
      WHEN check_violation THEN
        RAISE EXCEPTION 'One of the staged values does not fit its field (%). Nothing was published.', SQLERRM;
    END;
  END IF;

  IF p_studies AND jsonb_typeof(staged -> 'higher_studies') = 'array' THEN
    before := before || jsonb_build_object('higher_studies',
      (SELECT coalesce(jsonb_agg(to_jsonb(h) - 'id' - 'alumni_id'), '[]'::jsonb)
         FROM public.higher_studies h WHERE h.alumni_id = p_alumni_id));
    DELETE FROM public.higher_studies WHERE alumni_id = p_alumni_id;
    INSERT INTO public.higher_studies (alumni_id, degree_name, institution, start_year, finish_year)
    SELECT p_alumni_id, x.degree_name, x.institution, x.start_year, x.finish_year
      FROM jsonb_to_recordset(staged -> 'higher_studies')
        AS x(degree_name text, institution text, start_year int, finish_year int)
     WHERE btrim(coalesce(x.degree_name, '')) <> '';
  END IF;

  IF p_work AND jsonb_typeof(staged -> 'work_experience') = 'array' THEN
    before := before || jsonb_build_object('work_experience',
      (SELECT coalesce(jsonb_agg(to_jsonb(w) - 'id' - 'alumni_id'), '[]'::jsonb)
         FROM public.work_experience w WHERE w.alumni_id = p_alumni_id));
    DELETE FROM public.work_experience WHERE alumni_id = p_alumni_id;
    INSERT INTO public.work_experience (alumni_id, company, role, start_year, end_year, is_current)
    SELECT p_alumni_id, x.company, x.role, x.start_year, x.end_year, coalesce(x.is_current, false)
      FROM jsonb_to_recordset(staged -> 'work_experience')
        AS x(company text, role text, start_year int, end_year int, is_current boolean)
     WHERE btrim(coalesce(x.company, '')) <> '';
  END IF;

  -- The path lists, each only when ticked AND staged. Offers the school
  -- recorded are never touched by a student's list.
  lists := public.read_path_lists(p_alumni_id);
  BEGIN
    IF p_attempts AND jsonb_typeof(staged -> 'exam_attempts') = 'array' THEN
      before := before || jsonb_build_object('exam_attempts', lists -> 'exam_attempts');
      DELETE FROM public.exam_attempts WHERE alumni_id = p_alumni_id;
      PERFORM public.write_exam_attempts(p_alumni_id, staged -> 'exam_attempts');
    END IF;
    IF p_admits AND jsonb_typeof(staged -> 'admits') = 'array' THEN
      before := before || jsonb_build_object('admits', lists -> 'admits');
      DELETE FROM public.admits WHERE alumni_id = p_alumni_id AND NOT added_by_school;
      PERFORM public.write_admits(p_alumni_id, staged -> 'admits', false);
    END IF;
    IF p_gap_years AND jsonb_typeof(staged -> 'gap_years') = 'array' THEN
      before := before || jsonb_build_object('gap_years', lists -> 'gap_years');
      DELETE FROM public.gap_years WHERE alumni_id = p_alumni_id;
      PERFORM public.write_gap_years(p_alumni_id, staged -> 'gap_years');
    END IF;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR datatype_mismatch THEN
    RAISE EXCEPTION 'One of the staged exams, offers or gap years does not fit (%). Nothing was published.', SQLERRM;
  END;

  remainder := staged - keys;
  IF p_studies   THEN remainder := remainder - 'higher_studies'; END IF;
  IF p_work      THEN remainder := remainder - 'work_experience'; END IF;
  IF p_attempts  THEN remainder := remainder - 'exam_attempts'; END IF;
  IF p_admits    THEN remainder := remainder - 'admits'; END IF;
  IF p_gap_years THEN remainder := remainder - 'gap_years'; END IF;
  n_lists := p_studies::int + p_work::int + p_attempts::int + p_admits::int + p_gap_years::int;
  did := cardinality(keys) > 0 OR n_lists > 0;

  before := before || jsonb_build_object(
    'pending_changes', staged,
    'modification_status', a.modification_status,
    'last_updated', a.last_updated);

  UPDATE public.alumni
     SET pending_changes     = CASE WHEN remainder = '{}'::jsonb THEN NULL ELSE remainder END,
         modification_status = CASE WHEN remainder = '{}'::jsonb THEN 'none' ELSE 'pending' END,
         review_note         = coalesce(note, review_note),
         review_note_at      = CASE WHEN note IS NOT NULL THEN now() ELSE review_note_at END,
         last_updated        = CASE WHEN did THEN now() ELSE last_updated END
   WHERE id = p_alumni_id;

  PERFORM public.admin_log_event(
    'profile_edit', p_alumni_id::text, p_alumni_id, 'publish',
    format('Published %s change(s) for %s', cardinality(keys) + n_lists, a.full_name),
    note, before,
    jsonb_build_object('keys', to_jsonb(keys), 'studies', p_studies, 'work', p_work,
                       'attempts', p_attempts, 'admits', p_admits, 'gap_years', p_gap_years,
                       'pending_changes', remainder),
    true);

  RETURN jsonb_build_object(
    'published', to_jsonb(keys),
    'refused', to_jsonb(refused),
    'studies', p_studies,
    'work', p_work,
    'attempts', p_attempts,
    'admits', p_admits,
    'gap_years', p_gap_years,
    'still_waiting', remainder <> '{}'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text, boolean, boolean, boolean) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Undo - 16's function, plus the lists
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_undo(p_event_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  ev      public.review_events;
  a       public.alumni;
  keys    text[];
  set_sql text;
  now_pc  jsonb;
  was_pc  jsonb;
BEGIN
  PERFORM public.assert_school_admin();

  SELECT * INTO ev FROM public.review_events WHERE id = p_event_id FOR UPDATE;
  IF ev.id IS NULL THEN RAISE EXCEPTION 'No such event.'; END IF;
  IF NOT ev.undoable THEN RAISE EXCEPTION 'That decision cannot be undone.'; END IF;
  IF ev.undone_at IS NOT NULL THEN RAISE EXCEPTION 'That decision has already been undone.'; END IF;
  IF ev.before_state IS NULL THEN RAISE EXCEPTION 'Nothing was recorded to put back.'; END IF;

  IF ev.subject_kind IN ('registration', 'profile', 'profile_edit') THEN
    SELECT * INTO a FROM public.alumni WHERE id = ev.alumni_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION 'That profile no longer exists.'; END IF;

    IF ev.subject_kind = 'profile_edit' THEN
      now_pc := coalesce(a.pending_changes, '{}'::jsonb);
      was_pc := coalesce(ev.after_state -> 'pending_changes', '{}'::jsonb);
      IF now_pc <> was_pc THEN
        RAISE EXCEPTION 'This profile has been edited since. Undoing now would throw away newer changes.';
      END IF;
    END IF;

    SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO keys
      FROM jsonb_object_keys(ev.before_state) k
     WHERE k = ANY(public.publishable_edit_columns() ||
                   ARRAY['approval_status', 'rejection_reason', 'modification_status',
                         'pending_changes', 'last_updated', 'featured']::text[]);

    IF cardinality(keys) > 0 THEN
      set_sql := (SELECT string_agg(format('%I = p.%I', k, k), ', ') FROM unnest(keys) k);
      EXECUTE format(
        'UPDATE public.alumni a SET %s FROM jsonb_populate_record(NULL::public.alumni, $1) p WHERE a.id = $2',
        set_sql)
      USING ev.before_state, ev.alumni_id;
    END IF;

    IF jsonb_typeof(ev.before_state -> 'higher_studies') = 'array' THEN
      DELETE FROM public.higher_studies WHERE alumni_id = ev.alumni_id;
      INSERT INTO public.higher_studies (alumni_id, degree_name, institution, start_year, finish_year)
      SELECT ev.alumni_id, x.degree_name, x.institution, x.start_year, x.finish_year
        FROM jsonb_to_recordset(ev.before_state -> 'higher_studies')
          AS x(degree_name text, institution text, start_year int, finish_year int);
    END IF;

    IF jsonb_typeof(ev.before_state -> 'work_experience') = 'array' THEN
      DELETE FROM public.work_experience WHERE alumni_id = ev.alumni_id;
      INSERT INTO public.work_experience (alumni_id, company, role, start_year, end_year, is_current)
      SELECT ev.alumni_id, x.company, x.role, x.start_year, x.end_year, coalesce(x.is_current, false)
        FROM jsonb_to_recordset(ev.before_state -> 'work_experience')
          AS x(company text, role text, start_year int, end_year int, is_current boolean);
    END IF;

    IF jsonb_typeof(ev.before_state -> 'exam_attempts') = 'array' THEN
      DELETE FROM public.exam_attempts WHERE alumni_id = ev.alumni_id;
      PERFORM public.write_exam_attempts(ev.alumni_id, ev.before_state -> 'exam_attempts');
    END IF;
    IF jsonb_typeof(ev.before_state -> 'admits') = 'array' THEN
      DELETE FROM public.admits WHERE alumni_id = ev.alumni_id AND NOT added_by_school;
      PERFORM public.write_admits(ev.alumni_id, ev.before_state -> 'admits', false);
    END IF;
    IF jsonb_typeof(ev.before_state -> 'gap_years') = 'array' THEN
      DELETE FROM public.gap_years WHERE alumni_id = ev.alumni_id;
      PERFORM public.write_gap_years(ev.alumni_id, ev.before_state -> 'gap_years');
    END IF;

  ELSIF ev.subject_kind = 'photo' THEN
    UPDATE public.college_photos
       SET status      = coalesce(ev.before_state ->> 'status', status),
           reviewed_at = (ev.before_state ->> 'reviewed_at')::timestamptz,
           reviewed_by = (ev.before_state ->> 'reviewed_by')::uuid
     WHERE id = ev.subject_id::uuid;

  ELSIF ev.subject_kind = 'option' THEN
    INSERT INTO public.field_options (category, value, status, canonical_value)
    SELECT ev.before_state ->> 'category', ev.before_state ->> 'value',
           coalesce(ev.before_state ->> 'status', 'pending'), ev.before_state ->> 'canonical_value'
    ON CONFLICT (category, lower(value)) DO UPDATE
      SET status = EXCLUDED.status, canonical_value = EXCLUDED.canonical_value;

  ELSE
    RAISE EXCEPTION 'That kind of decision cannot be undone.';
  END IF;

  UPDATE public.review_events
     SET undone_at = now(), undone_by = auth.uid()
   WHERE id = ev.id;

  PERFORM public.admin_log_event(
    ev.subject_kind, ev.subject_id, ev.alumni_id, 'undo',
    format('Undid: %s', ev.summary), NULL, ev.after_state, ev.before_state, false);

  UPDATE public.review_events SET undo_of = ev.id
   WHERE id = (SELECT max(id) FROM public.review_events);

  RETURN jsonb_build_object('undone', ev.id, 'kind', ev.subject_kind, 'action', ev.action);
END
$$;

REVOKE ALL ON FUNCTION public.admin_undo(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_undo(bigint) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. Merging spellings - one explicit branch per kind of value
-- -----------------------------------------------------------------------------
-- A staged list is rewritten element by element, so publishing an edit later
-- cannot bring an old spelling back.
CREATE OR REPLACE FUNCTION public.rewrite_staged_list(p_staged jsonb, p_list text, p_field text, p_from text[], p_into text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(p_staged -> p_list) = 'array'
    THEN jsonb_set(p_staged, ARRAY[p_list], (
      SELECT coalesce(jsonb_agg(CASE WHEN public.norm_text(e ->> p_field) = ANY(p_from)
                                     THEN jsonb_set(e, ARRAY[p_field], to_jsonb(p_into)) ELSE e END), '[]'::jsonb)
        FROM jsonb_array_elements(p_staged -> p_list) e))
    ELSE p_staged END
$$;

CREATE OR REPLACE FUNCTION public.admin_merge_option(p_category text, p_from text[], p_into text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  col        text := public.option_column(p_category);
  display    text := btrim(regexp_replace(coalesce(p_into, ''), '\s+', ' ', 'g'));
  froms      text[];
  nfroms     text[];
  moved      int := 0;
  staged     int := 0;
  folded     int := 0;
  n          int;
  alias_rows int := 0;
  v          text;
  pair       record;
  f          public.exam_attempts;
BEGIN
  PERFORM public.assert_school_admin();
  IF col IS NULL AND p_category <> 'exam' THEN RAISE EXCEPTION 'That is not a kind of value we keep lists for.'; END IF;
  IF char_length(display) < 1 THEN RAISE EXCEPTION 'Give the name to keep.'; END IF;
  IF char_length(display) > 120 THEN RAISE EXCEPTION 'That name is too long.'; END IF;

  SELECT array_agg(DISTINCT x) INTO froms
    FROM unnest(coalesce(p_from, '{}'::text[])) AS x
   WHERE btrim(x) <> '' AND public.norm_text(x) <> public.norm_text(display);
  froms  := coalesce(froms, '{}'::text[]);
  nfroms := ARRAY(SELECT public.norm_text(x) FROM unnest(froms) x);

  -- The vocabulary first. An exam is canonicalised by trigger whenever it is
  -- written, so the rows below must find `display` already canonical - or a
  -- merge into what used to be an alias would be undone as it happened.
  INSERT INTO public.field_options (category, value, status, canonical_value)
  VALUES (p_category, display, 'approved', NULL)
  ON CONFLICT (category, lower(value))
  DO UPDATE SET status = 'approved', canonical_value = NULL, value = EXCLUDED.value;

  FOREACH v IN ARRAY froms LOOP
    INSERT INTO public.field_options (category, value, status, canonical_value)
    VALUES (p_category, v, 'approved', display)
    ON CONFLICT (category, lower(value))
    DO UPDATE SET canonical_value = display, status = 'approved';
    alias_rows := alias_rows + 1;
  END LOOP;

  -- Aliases that pointed at a spelling merged away now point at the survivor,
  -- so no alias ever leads to another alias. And the survivor keeps every area
  -- the merged spellings had.
  UPDATE public.field_options
     SET canonical_value = display
   WHERE category = p_category AND public.norm_text(canonical_value) = ANY(nfroms);
  UPDATE public.field_options t
     SET areas = (SELECT array_agg(DISTINCT x ORDER BY x) FROM (
                    SELECT unnest(coalesce(t.areas, '{}'::text[])) x
                    UNION SELECT unnest(o.areas) FROM public.field_options o
                     WHERE o.category = p_category AND public.norm_text(o.value) = ANY(nfroms) AND o.areas IS NOT NULL) s)
   WHERE t.category = p_category AND lower(t.value) = lower(display)
     AND EXISTS (SELECT 1 FROM public.field_options o
                  WHERE o.category = p_category AND public.norm_text(o.value) = ANY(nfroms) AND o.areas IS NOT NULL);

  IF p_category = 'exam' THEN
    -- The seat's exam, on the profile.
    UPDATE public.alumni SET admission_exam = display
     WHERE admission_kind = 'entrance_exam' AND public.norm_text(admission_exam) = ANY(nfroms);
    GET DIAGNOSTICS moved = ROW_COUNT;

    -- Every exam written. Two rows that become the same exam in the same year
    -- are one attempt: keep what either knew, then drop the duplicate.
    FOREACH v IN ARRAY nfroms LOOP
      FOR pair IN
        SELECT fx.id AS fid, dx.id AS did
          FROM public.exam_attempts fx
          JOIN public.exam_attempts dx
            ON dx.alumni_id = fx.alumni_id AND coalesce(dx.exam_year, 0) = coalesce(fx.exam_year, 0)
           AND public.norm_text(dx.exam) = public.norm_text(display)
         WHERE public.norm_text(fx.exam) = v
      LOOP
        SELECT * INTO f FROM public.exam_attempts WHERE id = pair.fid;
        DELETE FROM public.exam_attempts WHERE id = pair.fid;
        UPDATE public.exam_attempts d
           SET exam_rank  = coalesce(d.exam_rank, f.exam_rank),
               percentile = coalesce(d.percentile, f.percentile),
               gave_admit = CASE WHEN d.gave_admit OR f.gave_admit THEN true
                                 ELSE coalesce(d.gave_admit, f.gave_admit) END,
               got_seat   = d.got_seat OR f.got_seat
         WHERE d.id = pair.did;
        folded := folded + 1;
      END LOOP;
      UPDATE public.exam_attempts SET exam = display WHERE public.norm_text(exam) = v;
      GET DIAGNOSTICS n = ROW_COUNT;
      moved := moved + n;
    END LOOP;

    UPDATE public.admits SET exam = display WHERE public.norm_text(exam) = ANY(nfroms);
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;
    UPDATE public.gap_years SET exam = display WHERE public.norm_text(exam) = ANY(nfroms);
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;

    UPDATE public.alumni t
       SET pending_changes = s.pc
      FROM (SELECT id,
                   public.rewrite_staged_list(public.rewrite_staged_list(public.rewrite_staged_list(
                     CASE WHEN public.norm_text(pending_changes ->> 'admission_exam') = ANY(nfroms)
                          THEN jsonb_set(pending_changes, '{admission_exam}', to_jsonb(display)) ELSE pending_changes END,
                     'exam_attempts', 'exam', nfroms, display), 'admits', 'exam', nfroms, display),
                     'gap_years', 'exam', nfroms, display) AS pc
              FROM public.alumni WHERE pending_changes IS NOT NULL) s
     WHERE t.id = s.id AND s.pc IS DISTINCT FROM t.pending_changes;
    GET DIAGNOSTICS staged = ROW_COUNT;

  ELSE
    -- The column on the profile, as 14 did it.
    EXECUTE format('UPDATE public.alumni SET %I = $1 WHERE public.norm_text(%I) = ANY($2)', col, col)
      USING display, nfroms;
    GET DIAGNOSTICS moved = ROW_COUNT;

    UPDATE public.alumni
       SET pending_changes = jsonb_set(pending_changes, ARRAY[col], to_jsonb(display))
     WHERE pending_changes IS NOT NULL
       AND pending_changes ? col
       AND public.norm_text(pending_changes ->> col) = ANY(nfroms);
    GET DIAGNOSTICS staged = ROW_COUNT;

    -- A branch or a degree also lives on the offers not taken.
    IF p_category IN ('branch', 'degree') THEN
      EXECUTE format('UPDATE public.admits SET %I = $1 WHERE public.norm_text(%I) = ANY($2)', col, col)
        USING display, nfroms;
      GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;
      UPDATE public.alumni t
         SET pending_changes = s.pc
        FROM (SELECT id, public.rewrite_staged_list(pending_changes, 'admits', col, nfroms, display) AS pc
                FROM public.alumni WHERE pending_changes ? 'admits') s
       WHERE t.id = s.id AND s.pc IS DISTINCT FROM t.pending_changes;
      GET DIAGNOSTICS n = ROW_COUNT; staged := staged + n;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'display', display, 'moved_profiles', moved, 'moved_staged_edits', staged,
    'folded_attempts', folded, 'aliases', alias_rows);
END
$$;

REVOKE ALL ON FUNCTION public.admin_merge_option(text, text[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_merge_option(text, text[], text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Where every value is used - one read for the merge screen
-- -----------------------------------------------------------------------------
-- Counts people, not rows: someone who wrote JEE Main twice is one person.
CREATE OR REPLACE FUNCTION public.admin_option_usage()
RETURNS TABLE (category text, value text, uses bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_school_admin();
  RETURN QUERY
  WITH uses AS (
    SELECT 'stream'::text AS c, a.stream AS v, a.id AS who FROM public.alumni a WHERE a.stream IS NOT NULL
    UNION ALL SELECT 'degree', a.degree, a.id FROM public.alumni a WHERE a.degree IS NOT NULL
    UNION ALL SELECT 'degree', d.degree, d.alumni_id FROM public.admits d WHERE d.degree IS NOT NULL
    UNION ALL SELECT 'admission_route', a.admission_route, a.id FROM public.alumni a WHERE a.admission_route IS NOT NULL
    UNION ALL SELECT 'current_status', a.current_status, a.id FROM public.alumni a WHERE a.current_status IS NOT NULL
    UNION ALL SELECT 'field', a.field, a.id FROM public.alumni a WHERE a.field IS NOT NULL
    UNION ALL SELECT 'professional_course', a.professional_course, a.id FROM public.alumni a WHERE a.professional_course IS NOT NULL
    UNION ALL SELECT 'branch', a.branch, a.id FROM public.alumni a WHERE a.branch IS NOT NULL
    UNION ALL SELECT 'branch', d.branch, d.alumni_id FROM public.admits d WHERE d.branch IS NOT NULL
    UNION ALL SELECT 'exam', a.admission_exam, a.id FROM public.alumni a WHERE a.admission_exam IS NOT NULL
    UNION ALL SELECT 'exam', e.exam, e.alumni_id FROM public.exam_attempts e
    UNION ALL SELECT 'exam', d.exam, d.alumni_id FROM public.admits d WHERE d.exam IS NOT NULL
    UNION ALL SELECT 'exam', g.exam, g.alumni_id FROM public.gap_years g WHERE g.exam IS NOT NULL
  )
  SELECT u.c, u.v, count(DISTINCT u.who) FROM uses u WHERE btrim(u.v) <> '' GROUP BY u.c, u.v;
END
$$;

REVOKE ALL ON FUNCTION public.admin_option_usage() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_option_usage() TO authenticated;


-- -----------------------------------------------------------------------------
-- 8. How many are preparing again - per area, never per exam, never below 3
-- -----------------------------------------------------------------------------
-- Their profiles are hidden, so this is the only public trace of them, and it
-- must not be possible to work back to a person. Per area only: a per-exam
-- count could be subtracted from an area's to reveal a group of one. Below
-- three the area is left out altogether. Only rows the school has vetted, only
-- people who have not withdrawn consent, only the current academic year.
CREATE OR REPLACE FUNCTION public.pathway_preparing_counts()
RETURNS TABLE (area text, preparing bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ar AS area, count(DISTINCT a.id) AS preparing
    FROM public.alumni a
    JOIN public.gap_years g ON g.alumni_id = a.id
    JOIN public.field_options o
      ON o.category = 'exam' AND o.status = 'approved' AND o.canonical_value IS NULL
     AND lower(o.value) = lower(g.exam)
    CROSS JOIN LATERAL unnest(o.areas) ar
   WHERE a.in_gap_year AND a.approval_status = 'approved' AND a.consent_given IS NOT FALSE
     AND g.kind = 'preparing' AND g.gap_year = public.current_academic_year()
   GROUP BY ar
  HAVING count(DISTINCT a.id) >= 3
$$;

GRANT EXECUTE ON FUNCTION public.pathway_preparing_counts() TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 9. "Priya invited you"
-- -----------------------------------------------------------------------------
-- A share link carries the inviter's slug. The slug already spells their name,
-- so returning it adds nothing a link-holder did not have - but only for
-- someone who registered themselves or agreed to appear, and not for a
-- rejected profile. Never the id: the id is what claim_invite() resolves.
CREATE OR REPLACE FUNCTION public.invite_card(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('name', a.full_name, 'class_of', a.class_of)
    FROM public.alumni a
   WHERE a.public_slug = btrim(p_slug)
     AND a.approval_status <> 'rejected' AND a.consent_given IS NOT FALSE
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.invite_card(text) TO anon, authenticated;

-- The new profile records who sent them, once, before it is published. Runs
-- as the definer because the guard trigger freezes invited_by against the
-- owner's own writes: nobody may later rewrite who invited them.
CREATE OR REPLACE FUNCTION public.claim_invite(p_slug text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inviter uuid;
  n       int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT id INTO inviter FROM public.alumni
   WHERE public_slug = btrim(p_slug) AND approval_status <> 'rejected' AND consent_given IS NOT FALSE
     AND user_id IS DISTINCT FROM auth.uid();
  IF inviter IS NULL THEN RETURN false; END IF;
  UPDATE public.alumni SET invited_by = inviter
   WHERE user_id = auth.uid() AND invited_by IS NULL AND approval_status <> 'approved' AND id <> inviter;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;

REVOKE ALL ON FUNCTION public.claim_invite(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_invite(text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. Claim links - inviting a student to a profile the school started
-- -----------------------------------------------------------------------------
-- Only a hash of the token is stored: a leaked table must not hand anyone a
-- working link. The server route that reads it holds the service role; the
-- school can see which links went out and whether they were used.
CREATE TABLE IF NOT EXISTS public.claim_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id        uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  channel          text NOT NULL DEFAULT 'link' CHECK (channel IN ('email', 'whatsapp', 'link')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  created_by_email text,
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '14 days',
  used_at          timestamptz
);
CREATE INDEX IF NOT EXISTS claim_tokens_alumni_idx ON public.claim_tokens (alumni_id, created_at DESC);

REVOKE ALL ON public.claim_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claim_tokens TO authenticated;
ALTER TABLE public.claim_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins only" ON public.claim_tokens;
CREATE POLICY "Admins only" ON public.claim_tokens FOR ALL TO authenticated
  USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());


-- -----------------------------------------------------------------------------
-- 11. The import - hidden profiles from the school's sheet
-- -----------------------------------------------------------------------------
-- Called by the admin page with at most 25 rows at a time, so a slow network
-- or a bad row costs one small batch, not the file. Each row is its own
-- savepoint: one bad row is reported and the rest are created. A row whose
-- import_key already exists is reported "exists" and left alone, so running
-- the same file twice creates nobody twice.
--
-- Every profile starts hidden: pending, consent not given, no login. Nothing
-- is sent. The student is invited later, and publishes nothing until they
-- have agreed and the school has approved.
--
-- SECURITY DEFINER so the insert does not depend on the admin's own row
-- rights to set what self-service never can (origin, the review state); the
-- first line makes sure the caller is the school - with the strict check,
-- because the ordinary one cannot see the caller from inside a definer.
CREATE OR REPLACE FUNCTION public.admin_import_rows(p_batch uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r        jsonb;
  pv       jsonb;
  new_id   uuid;
  key      text;
  results  jsonb := '[]'::jsonb;
  created  int := 0;
  existing uuid;
  kind     text;
  exam     text;
BEGIN
  PERFORM public.assert_school_admin_strict();
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Send the rows as a list.'; END IF;
  IF jsonb_array_length(p_rows) > 25 THEN RAISE EXCEPTION 'At most 25 rows at a time.'; END IF;
  PERFORM 1 FROM public.import_batches WHERE id = p_batch;
  IF NOT FOUND THEN RAISE EXCEPTION 'That import batch does not exist.'; END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    key := nullif(btrim(r ->> 'import_key'), '');
    BEGIN
      IF key IS NULL THEN RAISE EXCEPTION 'This row has no import key.'; END IF;
      IF char_length(btrim(coalesce(r ->> 'full_name', ''))) < 2 THEN RAISE EXCEPTION 'This row has no name.'; END IF;

      SELECT id INTO existing FROM public.alumni WHERE import_key = key;
      IF existing IS NOT NULL THEN
        results := results || jsonb_build_object('key', key, 'status', 'exists', 'id', existing);
        CONTINUE;
      END IF;

      kind := nullif(r ->> 'admission_kind', '');
      exam := CASE WHEN kind = 'entrance_exam' THEN nullif(btrim(r ->> 'admission_exam'), '') END;
      IF kind = 'entrance_exam' AND exam IS NULL THEN kind := NULL; END IF;

      INSERT INTO public.alumni (
        user_id, full_name, school_name, school_board, class_of, stream,
        personal_email, phone_country_code, phone_number,
        college_id, college_name_raw, degree, branch, field,
        admission_kind, admission_exam, admission_detail, admission_rank, board_marks, board_cutoff,
        current_status, expected_finish_year, currently_at, linkedin_handle, in_gap_year,
        origin, import_batch_id, import_key,
        consent_given, approval_status, modification_status, show_photo)
      VALUES (
        NULL, btrim(r ->> 'full_name'), nullif(r ->> 'school_name', ''), nullif(r ->> 'school_board', ''),
        (r ->> 'class_of')::int, nullif(r ->> 'stream', ''),
        nullif(lower(btrim(r ->> 'personal_email')), ''),
        CASE WHEN nullif(r ->> 'phone_number', '') IS NOT NULL THEN coalesce(nullif(r ->> 'phone_country_code', ''), '+91') END,
        nullif(r ->> 'phone_number', ''),
        nullif(r ->> 'college_id', '')::uuid, nullif(r ->> 'college_name_raw', ''),
        nullif(r ->> 'degree', ''), nullif(r ->> 'branch', ''), nullif(r ->> 'field', ''),
        kind, exam, CASE WHEN kind IS NOT NULL THEN nullif(r ->> 'admission_detail', '') END,
        nullif(r ->> 'admission_rank', ''), nullif(r ->> 'board_marks', ''), nullif(r ->> 'board_cutoff', ''),
        nullif(r ->> 'current_status', ''), nullif(r ->> 'expected_finish_year', '')::int,
        nullif(r ->> 'currently_at', ''), nullif(lower(btrim(r ->> 'linkedin_handle')), ''),
        coalesce((r ->> 'in_gap_year')::boolean, false),
        'import', p_batch, key,
        false, 'pending', 'none', false)
      RETURNING id INTO new_id;

      pv := r -> 'private';
      IF jsonb_typeof(pv) = 'object' THEN
        INSERT INTO public.alumni_private (
          alumni_id, guardian1_name, guardian1_relation, guardian1_phone_code, guardian1_phone,
          guardian2_name, guardian2_relation, guardian2_phone_code, guardian2_phone,
          address_line, town, district, state, pin, source)
        VALUES (
          new_id, nullif(pv ->> 'guardian1_name', ''), nullif(pv ->> 'guardian1_relation', ''),
          coalesce(nullif(pv ->> 'guardian1_phone_code', ''), '+91'), nullif(pv ->> 'guardian1_phone', ''),
          nullif(pv ->> 'guardian2_name', ''), nullif(pv ->> 'guardian2_relation', ''),
          nullif(pv ->> 'guardian2_phone_code', ''), nullif(pv ->> 'guardian2_phone', ''),
          nullif(pv ->> 'address_line', ''), nullif(pv ->> 'town', ''), nullif(pv ->> 'district', ''),
          nullif(pv ->> 'state', ''), nullif(pv ->> 'pin', ''), 'import');
      END IF;

      IF nullif(btrim(r ->> 'office_note'), '') IS NOT NULL THEN
        INSERT INTO public.alumni_office_notes (alumni_id, note) VALUES (new_id, left(btrim(r ->> 'office_note'), 2000));
      END IF;

      PERFORM public.write_exam_attempts(new_id, r -> 'exam_attempts');
      PERFORM public.write_admits(new_id, r -> 'admits', true);
      PERFORM public.write_gap_years(new_id, r -> 'gap_years');

      created := created + 1;
      results := results || jsonb_build_object('key', key, 'status', 'created', 'id', new_id);
    EXCEPTION
      WHEN unique_violation THEN
        results := results || jsonb_build_object('key', key, 'status', 'error',
          'message', CASE WHEN SQLERRM LIKE '%email_key%' THEN 'That email is already on another profile.'
                          WHEN SQLERRM LIKE '%phone_key%' THEN 'That phone number is already on another profile.'
                          ELSE 'Something in this row is already on another profile.' END);
      WHEN OTHERS THEN
        results := results || jsonb_build_object('key', key, 'status', 'error', 'message', SQLERRM);
    END;
  END LOOP;

  UPDATE public.import_batches
     SET rows_seen = rows_seen + jsonb_array_length(p_rows), rows_created = rows_created + created
   WHERE id = p_batch;

  RETURN jsonb_build_object('created', created, 'rows', results);
END
$$;

REVOKE ALL ON FUNCTION public.admin_import_rows(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_import_rows(uuid, jsonb) TO authenticated;

-- A batch nobody has claimed can be taken back whole. Profiles someone has
-- signed in to, or the school has approved, are theirs now and stay.
CREATE OR REPLACE FUNCTION public.admin_discard_import_batch(p_batch uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  gone int;
  kept int;
BEGIN
  PERFORM public.assert_school_admin_strict();
  DELETE FROM public.alumni
   WHERE import_batch_id = p_batch AND user_id IS NULL AND approval_status <> 'approved';
  GET DIAGNOSTICS gone = ROW_COUNT;
  SELECT count(*) INTO kept FROM public.alumni WHERE import_batch_id = p_batch;
  PERFORM public.admin_log_event('import', p_batch::text, NULL, 'delete',
    format('Took back an import: %s unclaimed profile(s) removed, %s kept', gone, kept), NULL, NULL, NULL, false);
  RETURN jsonb_build_object('removed', gone, 'kept', kept);
END
$$;

REVOKE ALL ON FUNCTION public.admin_discard_import_batch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_discard_import_batch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK, in one transaction:
--   DROP FUNCTION admin_discard_import_batch(uuid), admin_import_rows(uuid, jsonb),
--     claim_invite(text), invite_card(text), pathway_preparing_counts(),
--     admin_option_usage(), rewrite_staged_list(jsonb, text, text, text[], text);
--   DROP TABLE claim_tokens;
--   DROP FUNCTION admin_publish_changes(uuid, text[], boolean, boolean, text, boolean, boolean, boolean);
--   restore 16's admin_publish_changes, admin_undo and publishable_edit_columns,
--   and 14's admin_merge_option;
--   DROP FUNCTION write_exam_attempts(uuid, jsonb), write_admits(uuid, jsonb, boolean),
--     write_gap_years(uuid, jsonb), read_path_lists(uuid);
--   restore 15's two CHECK constraints on review_events (after deleting any
--   'import' / 'invite' rows).
-- =============================================================================
