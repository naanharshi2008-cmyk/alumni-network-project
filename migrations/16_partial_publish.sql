-- =============================================================================
-- Veveaham Alumni - Migration 16: publish the parts you agree with
-- =============================================================================
-- Reviewing an edit is all-or-nothing today. Someone changes three things and
-- gets one of them wrong, and the school's only choices are to publish the
-- wrong one along with the right ones, or to throw all three away and ask them
-- to type it again. There is no third button.
--
-- There is also a hole underneath it. `pending_changes` is written by the
-- alumnus, and the guard trigger copies it verbatim - it has to, since it
-- cannot know what next year's profile editor will stage. Publishing then runs
-- as the school, which that same trigger treats as a trusted writer, so every
-- key in the blob reached a live column with all coercion bypassed. A staged
-- `featured` put someone on the home page; a staged `school_note` wrote a line
-- in the school's own voice. The dashboard now filters the blob before it
-- writes, but a rule that lives in a browser is a rule only while every caller
-- remembers it.
--
-- publishable_edit_columns() is that rule, next to the data, where it holds
-- for any caller. admin_publish_changes writes only what is BOTH asked for and
-- allowed, and hands back what it refused.
--
-- The whole thing is one transaction, which incidentally fixes a hazard the
-- dashboard has carried all along: timelines are replaced with a DELETE then
-- an INSERT, and a failed insert used to destroy a person's entire education
-- and work history. Here it rolls back.
--
-- REQUIRES 07 (is_school_admin), 10 (assert_school_admin), 15 (the review log).
-- Additive. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. What a staged edit may touch
-- -----------------------------------------------------------------------------
-- Exactly the columns app/profile/page.tsx builds in `columns`. Keep the two
-- in step: a field added to the profile editor and not added here will stage
-- fine and never publish, which the dashboard reports as "not recognised".
--
-- The three contact fields are here because an older client may still stage
-- them; their owner can change them live in any case, so publishing them
-- grants nothing that was not already theirs.
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
    'message_1', 'message_2', 'college_thoughts', 'photo_url', 'show_photo', 'consent_given'
  ]::text[]
$$;


-- -----------------------------------------------------------------------------
-- 2. Publish some of it
-- -----------------------------------------------------------------------------
-- `p_keys` are the columns the school ticked. Whatever is not published stays
-- staged and the person stays in the queue: nothing is thrown away quietly.
-- `p_note` is what they are told about the parts held back.
CREATE OR REPLACE FUNCTION public.admin_publish_changes(
  p_alumni_id uuid,
  p_keys      text[],
  p_studies   boolean DEFAULT false,
  p_work      boolean DEFAULT false,
  p_note      text DEFAULT NULL
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
  remainder jsonb;
  set_sql   text;
  did       boolean;
  note      text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  PERFORM public.assert_school_admin();

  SELECT * INTO a FROM public.alumni WHERE id = p_alumni_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That profile no longer exists.'; END IF;
  IF a.modification_status <> 'pending' THEN
    RAISE EXCEPTION 'There is nothing waiting for review on that profile.';
  END IF;

  staged := coalesce(a.pending_changes, '{}'::jsonb);

  -- Both asked for AND allowed AND actually staged.
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO keys
    FROM unnest(coalesce(p_keys, '{}'::text[])) k
   WHERE staged ? k AND k = ANY(public.publishable_edit_columns());

  -- What was asked for and refused, so the caller can be told rather than
  -- left to assume it worked.
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO refused
    FROM unnest(coalesce(p_keys, '{}'::text[])) k
   WHERE NOT (k = ANY(keys));

  IF cardinality(keys) > 0 THEN
    -- The old values, so this can be undone.
    SELECT jsonb_object_agg(k, to_jsonb(a) -> k) INTO before FROM unnest(keys) k;
    patched := (SELECT jsonb_object_agg(k, staged -> k) FROM unnest(keys) k);
    set_sql := (SELECT string_agg(format('%I = p.%I', k, k), ', ') FROM unnest(keys) k);

    -- jsonb_populate_record does the text -> integer/boolean/timestamptz
    -- casting; the SET list names only the ticked columns, so the NULLs it
    -- invents for everything else never land. The identifiers come from the
    -- allowlist above, not from the request.
    BEGIN
      EXECUTE format(
        'UPDATE public.alumni a SET %s FROM jsonb_populate_record(NULL::public.alumni, $1) p WHERE a.id = $2',
        set_sql)
      USING patched, p_alumni_id;
    EXCEPTION WHEN invalid_text_representation OR datatype_mismatch THEN
      RAISE EXCEPTION 'One of the staged values is not the right kind of thing for its field (%). Nothing was published.', SQLERRM;
    END;
  END IF;

  -- Timelines are stored as whole lists, so they are replaced, not merged -
  -- and in the same transaction as the columns, which is the point.
  IF p_studies AND jsonb_typeof(staged -> 'higher_studies') = 'array' THEN
    before := before || jsonb_build_object('higher_studies',
      (SELECT coalesce(jsonb_agg(to_jsonb(h) - 'id' - 'alumni_id'), '[]'::jsonb)
         FROM public.higher_studies h WHERE h.alumni_id = p_alumni_id));
    DELETE FROM public.higher_studies WHERE alumni_id = p_alumni_id;
    -- Named columns, so an id or an alumni_id smuggled into an entry is dropped.
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

  -- What is left keeps waiting. Unrecognised keys are left in it too: dropping
  -- them here would be the same silence this migration exists to end.
  remainder := staged - keys;
  IF p_studies THEN remainder := remainder - 'higher_studies'; END IF;
  IF p_work    THEN remainder := remainder - 'work_experience'; END IF;
  did := cardinality(keys) > 0 OR p_studies OR p_work;

  before := before || jsonb_build_object(
    'pending_changes', staged,
    'modification_status', a.modification_status,
    'last_updated', a.last_updated);

  UPDATE public.alumni
     SET pending_changes     = CASE WHEN remainder = '{}'::jsonb THEN NULL ELSE remainder END,
         modification_status = CASE WHEN remainder = '{}'::jsonb THEN 'none' ELSE 'pending' END,
         review_note         = coalesce(note, review_note),
         review_note_at      = CASE WHEN note IS NOT NULL THEN now() ELSE review_note_at END,
         -- Only when the public content actually changed. Publishing nothing
         -- but a note must not make the directory claim a fresh update.
         last_updated        = CASE WHEN did THEN now() ELSE last_updated END
   WHERE id = p_alumni_id;

  PERFORM public.admin_log_event(
    'profile_edit', p_alumni_id::text, p_alumni_id, 'publish',
    format('Published %s change(s) for %s', cardinality(keys) + p_studies::int + p_work::int, a.full_name),
    note, before,
    jsonb_build_object('keys', to_jsonb(keys), 'studies', p_studies, 'work', p_work,
                       'pending_changes', remainder),
    true);

  RETURN jsonb_build_object(
    'published', to_jsonb(keys),
    'refused', to_jsonb(refused),
    'studies', p_studies,
    'work', p_work,
    'still_waiting', remainder <> '{}'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. Discard some of it
-- -----------------------------------------------------------------------------
-- NULL keys means the whole blob, which is what the old button did. The
-- difference is that the blob survives in the log, so a discard is no longer
-- the end of the only copy of what somebody wrote.
CREATE OR REPLACE FUNCTION public.admin_discard_changes(
  p_alumni_id uuid,
  p_keys      text[] DEFAULT NULL,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  a         public.alumni;
  staged    jsonb;
  remainder jsonb;
  reason    text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  PERFORM public.assert_school_admin();

  SELECT * INTO a FROM public.alumni WHERE id = p_alumni_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That profile no longer exists.'; END IF;
  IF a.modification_status <> 'pending' THEN
    RAISE EXCEPTION 'There is nothing waiting for review on that profile.';
  END IF;

  staged := coalesce(a.pending_changes, '{}'::jsonb);
  remainder := CASE WHEN p_keys IS NULL THEN '{}'::jsonb ELSE staged - p_keys END;

  UPDATE public.alumni
     SET pending_changes     = CASE WHEN remainder = '{}'::jsonb THEN NULL ELSE remainder END,
         modification_status = CASE WHEN remainder = '{}'::jsonb THEN 'rejected' ELSE 'pending' END,
         review_note         = coalesce(reason, review_note),
         review_note_at      = CASE WHEN reason IS NOT NULL THEN now() ELSE review_note_at END
   WHERE id = p_alumni_id;

  PERFORM public.admin_log_event(
    'profile_edit', p_alumni_id::text, p_alumni_id, 'discard',
    format('Discarded %s for %s',
           CASE WHEN p_keys IS NULL THEN 'all staged changes' ELSE cardinality(p_keys) || ' change(s)' END,
           a.full_name),
    reason,
    jsonb_build_object('pending_changes', staged, 'modification_status', 'pending'),
    jsonb_build_object('pending_changes', remainder),
    true);

  RETURN jsonb_build_object('discarded', to_jsonb(coalesce(p_keys, ARRAY(SELECT jsonb_object_keys(staged)))),
                            'still_waiting', remainder <> '{}'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION public.admin_discard_changes(uuid, text[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_discard_changes(uuid, text[], text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. Take it back
-- -----------------------------------------------------------------------------
-- Undo refuses unless the world still looks the way the event left it. Without
-- that check, undoing a publish after the alumnus has staged fresh edits would
-- silently overwrite their newer work with the state from before.
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

    -- Has anything moved since? Compare what we left behind with what is there.
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

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK
--   DROP FUNCTION public.admin_undo(bigint);
--   DROP FUNCTION public.admin_discard_changes(uuid, text[], text);
--   DROP FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text);
--   DROP FUNCTION public.publishable_edit_columns();
-- Nothing here changes a table, so a rollback loses no data - but the
-- dashboard must go back to publishing the whole blob at the same time, which
-- reopens the hole described at the top.
-- =============================================================================
