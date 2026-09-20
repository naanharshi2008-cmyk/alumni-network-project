-- =============================================================================
-- Probe for migration 15, run in the Supabase SQL editor.
--
-- Paste migration 15 and then this file as one run: it all happens inside a
-- single transaction that ends by raising, so the table, the columns, the
-- trigger change and every row written here are rolled back. The raised
-- message is the result table.
-- =============================================================================

DO $$
DECLARE
  victim   uuid;
  other    uuid := '11111111-1111-1111-1111-111111111111';
  n        int;
  ev       bigint;
  staged   timestamptz;
  staged2  timestamptz;
  r        text := E'\n';
BEGIN
  SELECT id INTO victim FROM public.alumni ORDER BY created_at LIMIT 1;
  IF victim IS NULL THEN RAISE EXCEPTION 'No profiles to test with.'; END IF;

  -- ── A signed-in alumnus must not be able to write, read or forge ────────
  PERFORM set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', other), true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  BEGIN
    INSERT INTO public.review_events (actor_id, actor_email, subject_kind, subject_id, action, summary)
    VALUES (other::uuid, 'probe@veveaham-alumni-network.com', 'profile', victim::text, 'approve', 'sneaking in');
    r := r || 'FAIL  a non-admin wrote to the review log' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: only the school writes to the log' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  SELECT count(*) INTO n FROM public.review_events;
  r := r || CASE WHEN n = 0 THEN 'PASS  a non-admin reads nothing from the log' ELSE 'FAIL  ' || n || ' row(s) visible' END || E'\n';

  BEGIN
    PERFORM public.admin_log_event('profile', victim::text, victim, 'approve', 'via the function');
    r := r || 'FAIL  a non-admin logged an event through the function' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: the function asserts the school too' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  -- ── Anonymous visitors ──────────────────────────────────────────────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT count(*) INTO n FROM public.review_events;
    r := r || CASE WHEN n = 0 THEN 'PASS  anon sees nothing' ELSE 'FAIL  anon saw ' || n || ' row(s)' END || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  anon has no access to the log at all' || E'\n'; END;

  -- ── The school ──────────────────────────────────────────────────────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated","email":"staff@veveaham-admin.local"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  ev := public.admin_log_event(
    'registration', victim::text, victim, 'approve', 'Approved a probe row', NULL,
    jsonb_build_object('approval_status', 'pending'), jsonb_build_object('approval_status', 'approved'), true);

  SELECT count(*) INTO n FROM public.review_events
   WHERE id = ev AND actor_email = 'staff@veveaham-admin.local' AND undoable;
  r := r || CASE WHEN n = 1 THEN 'PASS  the school logs an event, named and undoable' ELSE 'FAIL  event not written as expected' END || E'\n';

  BEGIN
    INSERT INTO public.review_events (actor_id, actor_email, subject_kind, subject_id, action, summary)
    VALUES (other, 'staff@veveaham-admin.local', 'profile', victim::text, 'approve', 'in someone else''s name');
    r := r || 'FAIL  an event was written in another account''s name' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: the actor cannot be forged' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  BEGIN
    DELETE FROM public.review_events WHERE id = ev;
    GET DIAGNOSTICS n = ROW_COUNT;
    r := r || CASE WHEN n = 0 THEN 'PASS  nothing can be deleted from the log' ELSE 'FAIL  ' || n || ' event(s) deleted' END || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: the log has no DELETE grant' || E'\n'; END;

  UPDATE public.review_events SET undone_at = now() WHERE id = ev;
  GET DIAGNOSTICS n = ROW_COUNT;
  r := r || CASE WHEN n = 1 THEN 'PASS  an event can be marked undone' ELSE 'FAIL  could not mark it undone' END || E'\n';

  -- ── The school's note is the school's ───────────────────────────────────
  UPDATE public.alumni SET review_note = 'Held back the college name.', review_note_at = now() WHERE id = victim;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- The owner of the row tries to rewrite what the school told them.
  DECLARE owner_uid uuid;
  BEGIN
    SELECT user_id INTO owner_uid FROM public.alumni WHERE id = victim;
    IF owner_uid IS NULL THEN
      r := r || 'SKIP  that profile has no login, so the owner-write check cannot run' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated","email":"owner@veveaham-alumni-network.com"}', owner_uid), true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      UPDATE public.alumni SET review_note = 'I rewrote this myself' WHERE id = victim;
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', NULL, true);
      SELECT count(*) INTO n FROM public.alumni WHERE id = victim AND review_note = 'Held back the college name.';
      r := r || CASE WHEN n = 1 THEN 'PASS  the alumnus cannot rewrite the school''s note' ELSE 'FAIL  the note was overwritten' END || E'\n';
    END IF;
  END;

  -- ── edits_staged_at is derived, and does not drift ──────────────────────
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
  UPDATE public.alumni
     SET approval_status = 'approved', modification_status = 'none',
         pending_changes = NULL, edits_staged_at = NULL
   WHERE id = victim;

  DECLARE owner_uid uuid;
  BEGIN
    SELECT user_id INTO owner_uid FROM public.alumni WHERE id = victim;
    IF owner_uid IS NULL THEN
      r := r || 'SKIP  no login on that profile, so the staging clock cannot be tested as its owner' || E'\n';
    ELSE
      PERFORM set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated","email":"owner@veveaham-alumni-network.com"}', owner_uid), true);
      EXECUTE 'SET LOCAL ROLE authenticated';

      UPDATE public.alumni
         SET pending_changes = '{"degree":"Probe"}'::jsonb, modification_status = 'pending'
       WHERE id = victim;
      SELECT edits_staged_at INTO staged FROM public.alumni WHERE id = victim;
      r := r || CASE WHEN staged IS NOT NULL THEN 'PASS  staging an edit starts the clock'
                     ELSE 'FAIL  edits_staged_at was not set' END || E'\n';

      PERFORM pg_sleep(0.05);
      UPDATE public.alumni
         SET pending_changes = '{"degree":"Probe again"}'::jsonb, modification_status = 'pending'
       WHERE id = victim;
      SELECT edits_staged_at INTO staged2 FROM public.alumni WHERE id = victim;
      r := r || CASE WHEN staged2 = staged THEN 'PASS  saving again while waiting does not reset the clock'
                     ELSE 'FAIL  the wait was shortened by a second save' END || E'\n';

      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', NULL, true);
    END IF;
  END;

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULTS %(everything above was rolled back)', r;
END $$;
