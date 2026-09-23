-- =============================================================================
-- Veveaham Alumni - Migration 21: a higher-studies institute is a real college
-- =============================================================================
-- Round 11. Since schema.sql, `higher_studies.institution` has been free text
-- and nothing else. So an alumnus who did an MSc at PSG Tech could not link to
-- it from their own page, and PSG Tech's page never knew they were there - the
-- one kind of path a junior looking at "what comes after a degree" most wants
-- to follow. Offers have carried a real `college_id` since migration 18; this
-- gives studies the same, and adds the public view they should have had.
--
-- REQUIRES: 09 (inst_key, colleges.merged_into), 10 (resolve_institute,
-- institute_aliases, the institutes view), 18 (the admits pattern,
-- merge_institute v3, alumnus_is_listed), 19 (publish / undo), 20 (the owner
-- policies on higher_studies). Run as one transaction.
--
-- SAFE TO RE-RUN. Every statement is idempotent.
--
-- TO ROLL BACK: DROP VIEW public.public_higher_studies;
--   DROP TRIGGER higher_studies_follow_merges ON public.higher_studies;
--   DROP FUNCTION public.higher_studies_follow_merges(), public.write_higher_studies(uuid, jsonb);
--   ALTER TABLE public.higher_studies DROP COLUMN college_id;
--   re-issue 19's admin_publish_changes and admin_undo, and 18's merge_institute.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. The link
-- -----------------------------------------------------------------------------
-- No CHECK demanding one of college_id / institution, unlike admits'
-- admits_names_a_college. Both forms call the institution optional today
-- (register:1453, profile:956), so rows of the shape ("PhD", no institute)
-- are ones the product deliberately allows and almost certainly exist. A
-- validating CHECK would abort this migration on them; a NOT VALID one would
-- still fire the next time such a row was saved from a form that calls the
-- field optional. The invariant that matters - a row naming a college always
-- carries the college's name as its text - is kept by write_higher_studies
-- below, where every server-side write goes through.
ALTER TABLE public.higher_studies
  ADD COLUMN IF NOT EXISTS college_id uuid REFERENCES public.colleges(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS higher_studies_college_idx
  ON public.higher_studies (college_id) WHERE college_id IS NOT NULL;

COMMENT ON COLUMN public.higher_studies.college_id IS
  'The college this degree was read at, when it resolved to one. `institution` keeps the text either way.';

-- Links always land on a surviving institute (the shape of admits_follow_merges).
CREATE OR REPLACE FUNCTION public.higher_studies_follow_merges()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.college_id IS NOT NULL THEN
    NEW.college_id := coalesce((SELECT merged_into FROM colleges WHERE id = NEW.college_id), NEW.college_id);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS higher_studies_follow_merges ON public.higher_studies;
CREATE TRIGGER higher_studies_follow_merges BEFORE INSERT OR UPDATE OF college_id ON public.higher_studies
  FOR EACH ROW EXECUTE FUNCTION public.higher_studies_follow_merges();


-- -----------------------------------------------------------------------------
-- 2. One writer, so the column list lives in one place
-- -----------------------------------------------------------------------------
-- The other three lists got a writer in migration 19; higher studies did not,
-- and its column list was spelled out twice - in admin_publish_changes and
-- again in admin_undo. Adding a column to one and not the other loses it
-- silently at the moment of approval, which is the worst possible moment.
--
-- Named columns only, like 19's three: an id or an alumni_id smuggled into a
-- staged entry is dropped. SECURITY INVOKER, so it grants nothing of its own -
-- every row still meets the caller's policies.
CREATE OR REPLACE FUNCTION public.write_higher_studies(p_alumni_id uuid, p_list jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array' THEN RETURN; END IF;
  INSERT INTO public.higher_studies (alumni_id, degree_name, college_id, institution, start_year, finish_year)
  SELECT p_alumni_id, btrim(x.degree_name), x.college_id,
         -- A row that names a college always keeps the college's name as its
         -- text too, so every page that reads `institution` (profilePath,
         -- showcase) keeps working without knowing the link exists.
         coalesce(nullif(btrim(x.institution), ''),
                  (SELECT c.name FROM public.colleges c WHERE c.id = x.college_id)),
         x.start_year, x.finish_year
    FROM jsonb_to_recordset(p_list)
      AS x(degree_name text, college_id uuid, institution text, start_year int, finish_year int)
   WHERE btrim(coalesce(x.degree_name, '')) <> '';
END
$$;

REVOKE ALL ON FUNCTION public.write_higher_studies(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.write_higher_studies(uuid, jsonb) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. Linking what is already there - only where it is beyond doubt
-- -----------------------------------------------------------------------------
-- resolve_institute (migration 10) is the one definition of "unambiguous" the
-- whole site uses: an exact name key or an exact alias key, merged-away rows
-- skipped, and NULL unless exactly one institute matches. lib/institutes.ts
-- calls the same function when a student picks a college. No trigram, no
-- guessing: Round 10 watched a fuzzy matcher resolve "Amitra" to a college of
-- education with complete confidence, and a wrong link here would put a
-- stranger on a college's page.
--
-- Runs after the trigger exists, so a match onto a merged row is flattened to
-- its survivor. Everything it declines stays as text for the office to link by
-- hand; the probe prints those names.
UPDATE public.higher_studies h
   SET college_id = public.resolve_institute('college', h.institution)
 WHERE h.college_id IS NULL
   AND btrim(coalesce(h.institution, '')) <> ''
   AND public.resolve_institute('college', h.institution) IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 4. The public view
-- -----------------------------------------------------------------------------
-- Mirrors public_admits, embedded college object and all, so a page can draw
-- the link without a second request. The predicate is spelled out rather than
-- calling alumnus_is_listed(): that is how all four of migration 18's views
-- spell it, and a per-row SECURITY DEFINER call would defeat the join.
--
-- Anon keeps its SELECT on the base table. verify_security.mjs asserts that it
-- is readable, and that check exists to prove migration 02's SECURITY DEFINER
-- helper survived - revoking belongs in its own migration, with the probe and
-- the verify script changed together.
CREATE OR REPLACE VIEW public.public_higher_studies AS
SELECT h.id, h.alumni_id, h.degree_name, h.institution, h.college_id,
       h.start_year, h.finish_year,
       CASE WHEN c.id IS NULL THEN NULL ELSE
         jsonb_build_object(
           'name', c.name, 'state', c.state, 'district', c.district, 'logo_url', c.logo_url,
           'aliases', coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                                  FROM institute_aliases ia WHERE ia.college_id = c.id), '[]'::jsonb))
       END AS college
  FROM public.higher_studies h
  JOIN public.alumni a ON a.id = h.alumni_id
  LEFT JOIN public.colleges c ON c.id = h.college_id
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;

REVOKE ALL ON public.public_higher_studies FROM anon, authenticated;
GRANT SELECT ON public.public_higher_studies TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. The one path table whose admin policy was not the named helper
-- -----------------------------------------------------------------------------
-- Migration 20's loop gave higher_studies and work_experience the four owner
-- policies but no "Admins manage" - the school still writes through
-- schema.sql's original `auth.email() LIKE '%@veveaham-admin.local'`, which is
-- byte-for-byte what is_school_admin() tests. Identical behaviour, but it is
-- the only path table not saying so out loud, and the next person to read the
-- policies should not have to work that out.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['higher_studies', 'work_experience'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "Admins manage" ON public.%I FOR ALL TO authenticated
                      USING (public.is_school_admin()) WITH CHECK (public.is_school_admin())$p$, t);
  END LOOP;
END
$$;


-- -----------------------------------------------------------------------------
-- 6. The three functions that had the old column list, re-issued
-- -----------------------------------------------------------------------------
-- Copied forward from 19 and 18 unchanged except where marked. The house
-- pattern (migration 20 did the same with admin_merge_option): a long body is
-- re-issued whole rather than patched, so what runs is what you can read here.
--
-- admin_publish_changes keeps its identical eight-argument signature and is
-- NEVER dropped - PostgREST cannot choose between two overloads (PGRST203,
-- the lesson at 19:163), and a second copy stops the review screen publishing
-- anything at all.
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
    -- Migration 21: one writer, so the column list lives in a single place.
    -- It used to be spelled out here and again in admin_undo, and a column
    -- added to one and not the other is silently dropped on approval.
    PERFORM public.write_higher_studies(p_alumni_id, staged -> 'higher_studies');
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
      -- A before_state written before migration 21 carries no college_id key,
      -- so jsonb_to_recordset yields NULL for it and the row comes back
      -- unlinked - which is exactly what was there.
      PERFORM public.write_higher_studies(ev.alumni_id, ev.before_state -> 'higher_studies');
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

CREATE OR REPLACE FUNCTION public.merge_institute(p_kind text, p_from uuid, p_into uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid;
  moved_alumni int := 0;
  moved_staged int := 0;
  moved_studies int := 0;
BEGIN
  PERFORM public.assert_school_admin();
  IF p_kind NOT IN ('college', 'organization') THEN RAISE EXCEPTION 'Unknown institute kind.'; END IF;
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN RAISE EXCEPTION 'Pick two different institutes.'; END IF;

  IF p_kind = 'college' THEN
    SELECT coalesce(merged_into, id) INTO target FROM colleges WHERE id = p_into FOR UPDATE;
    IF target IS NULL THEN RAISE EXCEPTION 'The institute to keep no longer exists.'; END IF;
    PERFORM 1 FROM colleges WHERE id = p_from FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The duplicate no longer exists.'; END IF;
    IF target = p_from THEN RAISE EXCEPTION 'That institute is already merged the other way.'; END IF;

    UPDATE alumni SET college_id = target WHERE college_id = p_from;
    GET DIAGNOSTICS moved_alumni = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{college_id}', to_jsonb(target::text))
     WHERE pending_changes->>'college_id' = p_from::text;
    GET DIAGNOSTICS moved_staged = ROW_COUNT;

    -- Offers follow the college. One that becomes a duplicate of an offer
    -- already at the survivor is folded into it first, so the move cannot
    -- trip the once-per-person index.
    DELETE FROM admits x
     WHERE x.college_id = p_from
       AND EXISTS (SELECT 1 FROM admits y
                    WHERE y.college_id = target AND y.alumni_id = x.alumni_id
                      AND coalesce(lower(y.degree), '') = coalesce(lower(x.degree), '')
                      AND coalesce(y.admit_year, 0) = coalesce(x.admit_year, 0));
    UPDATE admits SET college_id = target WHERE college_id = p_from;

    -- A degree read at the duplicate was read at the survivor (migration 21).
    -- No fold, unlike admits: higher_studies has no once-per-person index, so
    -- two rows that become the same place are two real entries - an MSc and a
    -- PhD at what turned out to be one university.
    UPDATE higher_studies SET college_id = target WHERE college_id = p_from;
    GET DIAGNOSTICS moved_studies = ROW_COUNT;

    DELETE FROM institute_aliases a
     WHERE a.college_id = p_from
       AND EXISTS (SELECT 1 FROM institute_aliases b WHERE b.college_id = target AND b.alias_key = a.alias_key);
    UPDATE institute_aliases SET college_id = target WHERE college_id = p_from;
    INSERT INTO institute_aliases (college_id, alias, source)
    SELECT target, f.name, 'merged' FROM colleges f, colleges t
     WHERE f.id = p_from AND t.id = target AND f.name_key <> t.name_key AND char_length(f.name_key) >= 2
    ON CONFLICT (entity_id, alias_key) DO NOTHING;

    -- Photos belong to the college, and the college is now the survivor.
    -- Without this a merge orphaned every approved campus photo of the loser.
    UPDATE college_photos SET college_id = target WHERE college_id = p_from;

    UPDATE colleges t
       SET banner_url  = coalesce(t.banner_url, f.banner_url),
           -- logo_url arrived in migration 13, after this function was written,
           -- so merging used to lose a logo silently.
           logo_url    = coalesce(t.logo_url, f.logo_url),
           description = coalesce(t.description, f.description),
           -- Credit travels WITH the banner, never on its own: coalescing it
           -- would put a student's name under a photograph they did not take.
           banner_credit   = CASE WHEN t.banner_url IS NULL THEN f.banner_credit   ELSE t.banner_credit   END,
           banner_photo_id = CASE WHEN t.banner_url IS NULL THEN f.banner_photo_id ELSE t.banner_photo_id END
      FROM colleges f WHERE t.id = target AND f.id = p_from;
    UPDATE colleges SET merged_into = target WHERE id = p_from OR merged_into = p_from;
  ELSE
    SELECT coalesce(merged_into, id) INTO target FROM organizations WHERE id = p_into FOR UPDATE;
    IF target IS NULL THEN RAISE EXCEPTION 'The organisation to keep no longer exists.'; END IF;
    PERFORM 1 FROM organizations WHERE id = p_from FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The duplicate no longer exists.'; END IF;
    IF target = p_from THEN RAISE EXCEPTION 'That organisation is already merged the other way.'; END IF;

    UPDATE alumni SET organization_id = target WHERE organization_id = p_from;
    GET DIAGNOSTICS moved_alumni = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{organization_id}', to_jsonb(target::text))
     WHERE pending_changes->>'organization_id' = p_from::text;
    GET DIAGNOSTICS moved_staged = ROW_COUNT;

    -- A coaching centre is an organisation too.
    UPDATE gap_years SET coaching_org_id = target WHERE coaching_org_id = p_from;

    DELETE FROM institute_aliases a
     WHERE a.organization_id = p_from
       AND EXISTS (SELECT 1 FROM institute_aliases b WHERE b.organization_id = target AND b.alias_key = a.alias_key);
    UPDATE institute_aliases SET organization_id = target WHERE organization_id = p_from;
    INSERT INTO institute_aliases (organization_id, alias, source)
    SELECT target, f.name, 'merged' FROM organizations f, organizations t
     WHERE f.id = p_from AND t.id = target AND f.name_key <> t.name_key AND char_length(f.name_key) >= 2
    ON CONFLICT (entity_id, alias_key) DO NOTHING;
    UPDATE organizations SET merged_into = target WHERE id = p_from OR merged_into = p_from;
  END IF;

  RETURN jsonb_build_object('into', target, 'moved_alumni', moved_alumni,
                            'moved_staged_edits', moved_staged, 'moved_studies', moved_studies);
END
$$;

REVOKE ALL ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_publish_changes(uuid, text[], boolean, boolean, text, boolean, boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_undo(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_undo(bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.merge_institute(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_institute(text, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
