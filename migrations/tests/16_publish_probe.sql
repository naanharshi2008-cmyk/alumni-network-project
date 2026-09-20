-- =============================================================================
-- Probe for migration 16, run in the Supabase SQL editor.
--
-- Paste migration 16 and then this file as one run: it all happens inside a
-- single transaction that ends by raising, so the functions, the test blob and
-- every row touched here are rolled back. The raised message is the results.
--
-- Migration 15 must already be applied (this uses review_events and
-- edits_staged_at). If it is not, paste 15, 16 and this file together.
-- =============================================================================

DO $$
DECLARE
  victim   uuid;
  -- review_events.actor_id references auth.users, so the staff account this
  -- probe pretends to be has to be a real login. What makes a caller the
  -- school is the email in the JWT claims, not the id, so any real id will
  -- do. It all rolls back either way.
  staff    uuid;
  before   public.alumni;
  after    public.alumni;
  res      jsonb;
  ev       bigint;
  n        int;
  r        text := E'\n';
BEGIN
  SELECT id INTO victim FROM public.alumni WHERE approval_status = 'approved' ORDER BY created_at LIMIT 1;
  IF victim IS NULL THEN RAISE EXCEPTION 'No approved profile to test with.'; END IF;
  SELECT id INTO staff FROM auth.users ORDER BY created_at LIMIT 1;
  IF staff IS NULL THEN RAISE EXCEPTION 'No logins to borrow an id from.'; END IF;
  SELECT * INTO before FROM public.alumni WHERE id = victim;

  -- A blob with three real edits and four reaches for columns the profile
  -- editor never sets. This is what a hand-crafted PATCH can stage today.
  UPDATE public.alumni
     SET modification_status = 'pending',
         pending_changes = jsonb_build_object(
           'message_1',        'ZZ probe advice',
           'degree',           'ZZ Probe Degree',
           'branch',           'ZZ Probe Branch',
           'featured',         true,
           'school_note',      'ZZ the school says so',
           'approval_status',  'approved',
           'user_id',          '00000000-0000-0000-0000-000000000001',
           'higher_studies',   jsonb_build_array(jsonb_build_object(
             'degree_name', 'ZZ Probe MSc', 'institution', 'ZZ Probe Institute',
             'start_year', 2030, 'finish_year', 2032)))
   WHERE id = victim;

  -- ── Only the school ─────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_publish_changes(victim, ARRAY['message_1'], false, false, NULL);
    r := r || 'FAIL  a non-admin published someone''s changes' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: only the school publishes' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"staff@veveaham-admin.local"}', staff), true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- ── The one that matters: ask for the dangerous keys explicitly ─────────
  res := public.admin_publish_changes(
    victim,
    ARRAY['message_1', 'degree', 'featured', 'school_note', 'approval_status', 'user_id'],
    true, false, 'Held back the branch for now.');
  r := r || 'note    ' || res::text || E'\n';

  SELECT * INTO after FROM public.alumni WHERE id = victim;

  r := r || CASE WHEN after.message_1 = 'ZZ probe advice' AND after.degree = 'ZZ Probe Degree'
                 THEN 'PASS  the two ticked fields published' ELSE 'FAIL  the ticked fields did not publish' END || E'\n';

  r := r || CASE WHEN after.featured IS NOT DISTINCT FROM before.featured
                 THEN 'PASS  a staged "featured" did not put them on the home page'
                 ELSE 'FAIL  featured was published' END || E'\n';
  r := r || CASE WHEN after.school_note IS NOT DISTINCT FROM before.school_note
                 THEN 'PASS  a staged "school_note" did not write in the school''s voice'
                 ELSE 'FAIL  school_note was published' END || E'\n';
  r := r || CASE WHEN after.user_id IS NOT DISTINCT FROM before.user_id
                 THEN 'PASS  a staged "user_id" did not move the login'
                 ELSE 'FAIL  user_id was published' END || E'\n';

  r := r || CASE WHEN res -> 'refused' @> '["featured"]'::jsonb AND res -> 'refused' @> '["user_id"]'::jsonb
                 THEN 'PASS  the refusals are reported back, not swallowed'
                 ELSE 'FAIL  refusals were not reported' END || E'\n';

  -- ── The rest keeps waiting ──────────────────────────────────────────────
  r := r || CASE WHEN after.modification_status = 'pending' AND after.pending_changes ? 'branch'
                 THEN 'PASS  the field we did not tick is still waiting, and so is the person'
                 ELSE 'FAIL  the unticked field was lost' END || E'\n';
  r := r || CASE WHEN after.pending_changes ? 'featured'
                 THEN 'PASS  the unrecognised keys are still there to be seen, not silently dropped'
                 ELSE 'FAIL  unrecognised keys vanished' END || E'\n';
  r := r || CASE WHEN after.review_note = 'Held back the branch for now.'
                 THEN 'PASS  the alumnus is told what was held back'
                 ELSE 'FAIL  no note reached the profile' END || E'\n';

  SELECT count(*) INTO n FROM public.higher_studies
   WHERE alumni_id = victim AND degree_name = 'ZZ Probe MSc';
  r := r || CASE WHEN n = 1 THEN 'PASS  the study entry published with the columns, in one transaction'
                 ELSE 'FAIL  the timeline did not publish' END || E'\n';

  -- ── Publishing nothing but a note must not claim a fresh update ─────────
  DECLARE stamp timestamptz;
  BEGIN
    SELECT last_updated INTO stamp FROM public.alumni WHERE id = victim;
    PERFORM public.admin_publish_changes(victim, '{}'::text[], false, false, 'Still thinking about the branch.');
    SELECT last_updated INTO after.last_updated FROM public.alumni WHERE id = victim;
    r := r || CASE WHEN after.last_updated IS NOT DISTINCT FROM stamp
                   THEN 'PASS  a note alone does not bump "last updated"'
                   ELSE 'FAIL  last_updated moved with nothing published' END || E'\n';
  END;

  -- ── Undo puts the columns and the timeline back ─────────────────────────
  SELECT id INTO ev FROM public.review_events
   WHERE alumni_id = victim AND action = 'publish' ORDER BY id LIMIT 1;

  DECLARE stamped jsonb;
  BEGIN
    SELECT after_state -> 'pending_changes' INTO stamped FROM public.review_events WHERE id = ev;

    -- The alumnus saves again while the school is still looking at the queue.
    -- This has to be done for real: the earlier version of this probe simply
    -- called undo and expected a refusal, which is a test of nothing, because
    -- publishing a note alone leaves the staging area exactly as it found it.
    UPDATE public.alumni
       SET pending_changes = coalesce(stamped, '{}'::jsonb) || '{"branch":"ZZ Newer Branch"}'::jsonb
     WHERE id = victim;
    BEGIN
      PERFORM public.admin_undo(ev);
      r := r || 'FAIL  undo ran even though the profile had changed since' || E'\n';
    EXCEPTION WHEN OTHERS THEN
      r := r || CASE WHEN SQLERRM LIKE '%edited since%'
                     THEN 'PASS  undo refuses once the profile has moved on'
                     ELSE 'PASS? undo refused (' || SQLERRM || ')' END || E'\n';
    END;

    -- Put the staging area back exactly as the publish left it, then undo.
    UPDATE public.alumni SET pending_changes = stamped WHERE id = victim;
    PERFORM public.admin_undo(ev);
    SELECT * INTO after FROM public.alumni WHERE id = victim;
    r := r || CASE WHEN after.message_1 IS NOT DISTINCT FROM before.message_1
                        AND after.degree IS NOT DISTINCT FROM before.degree
                   THEN 'PASS  undo restored the published columns'
                   ELSE 'FAIL  undo did not restore the columns' END || E'\n';
    SELECT count(*) INTO n FROM public.higher_studies WHERE alumni_id = victim AND degree_name = 'ZZ Probe MSc';
    r := r || CASE WHEN n = 0 THEN 'PASS  undo restored the timeline'
                   ELSE 'FAIL  the probe study entry survived the undo' END || E'\n';
  END;

  BEGIN
    PERFORM public.admin_undo(ev);
    r := r || 'FAIL  the same decision was undone twice' || E'\n';
  EXCEPTION WHEN OTHERS THEN
    r := r || CASE WHEN SQLERRM LIKE '%already been undone%'
                   THEN 'PASS  a decision cannot be undone twice'
                   ELSE 'PASS? refused (' || SQLERRM || ')' END || E'\n';
  END;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULTS %(everything above was rolled back)', r;
END $$;
