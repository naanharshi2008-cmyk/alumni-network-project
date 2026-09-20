-- =============================================================================
-- Probe for migration 14, run in the Supabase SQL editor.
--
-- Paste migration 14 and then this file as one run: it all happens inside a
-- single transaction that ends by raising, so the merge, the aliases and the
-- test edit are rolled back. The raised message is the result table.
-- =============================================================================

DO $$
DECLARE
  cat        text := 'admission_route';
  display    text := 'ZZ Probe Route';
  spelling_a text := 'ZZ  Probe   Route';   -- the same thing, typed sloppily
  spelling_b text := 'ZZ Probe Rout';       -- and mistyped
  victim     uuid;
  before_a   int;
  n          int;
  res        jsonb;
  r          text := E'\n';
BEGIN
  -- A profile to move, and an edit waiting for review that mentions the old
  -- spelling. Both are restored when this block raises.
  SELECT id INTO victim FROM public.alumni ORDER BY created_at LIMIT 1;
  IF victim IS NULL THEN RAISE EXCEPTION 'No profiles to test with.'; END IF;

  UPDATE public.alumni
     SET admission_route = spelling_a,
         pending_changes = coalesce(pending_changes, '{}'::jsonb) || jsonb_build_object('admission_route', spelling_b)
   WHERE id = victim;

  SELECT count(*) INTO before_a FROM public.alumni WHERE admission_route = spelling_a;
  r := r || format('setup   %s profile(s) on the sloppy spelling', before_a) || E'\n';

  -- A signed-in alumnus must not be able to rewrite everyone's data.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"probe@veveaham-alumni-network.com"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_merge_option(cat, ARRAY[spelling_a], display);
    r := r || 'FAIL  a non-admin merged option values' || E'\n';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS  refused: only the school can merge values' || E'\n';
            WHEN OTHERS THEN r := r || 'PASS? refused (' || SQLERRM || ')' || E'\n'; END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated","email":"staff@veveaham-admin.local"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  res := public.admin_merge_option(cat, ARRAY[spelling_a, spelling_b], display);
  r := r || 'note    ' || res::text || E'\n';

  SELECT count(*) INTO n FROM public.alumni WHERE admission_route = display;
  r := r || CASE WHEN n >= before_a THEN 'PASS  profiles moved to the display name' ELSE 'FAIL  profiles did not move' END || E'\n';

  SELECT count(*) INTO n FROM public.alumni WHERE admission_route IN (spelling_a, spelling_b);
  r := r || CASE WHEN n = 0 THEN 'PASS  no profile is left on an old spelling' ELSE 'FAIL  ' || n || ' left behind' END || E'\n';

  SELECT count(*) INTO n FROM public.alumni WHERE pending_changes->>'admission_route' = display AND id = victim;
  r := r || CASE WHEN n = 1 THEN 'PASS  the waiting edit moved too' ELSE 'FAIL  staged edit still on the old spelling' END || E'\n';

  SELECT count(*) INTO n FROM public.field_options
   WHERE category = cat AND value = display AND status = 'approved' AND canonical_value IS NULL;
  r := r || CASE WHEN n = 1 THEN 'PASS  the display name is an approved option' ELSE 'FAIL  display name missing from the list' END || E'\n';

  SELECT count(*) INTO n FROM public.field_options
   WHERE category = cat AND canonical_value = display;
  r := r || CASE WHEN n = 2 THEN 'PASS  both old spellings kept as aliases' ELSE 'FAIL  ' || n || ' alias row(s)' END || E'\n';

  -- Merging again with the same name must be harmless.
  res := public.admin_merge_option(cat, ARRAY[spelling_a], display);
  r := r || 'PASS  re-running the same merge is safe' || E'\n';

  PERFORM public.admin_forget_alias(cat, spelling_b);
  SELECT count(*) INTO n FROM public.field_options WHERE category = cat AND value = spelling_b;
  r := r || CASE WHEN n = 0 THEN 'PASS  an alias can be forgotten' ELSE 'FAIL  alias survived' END || E'\n';

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', NULL, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM public.field_options WHERE category = cat AND canonical_value = display;
  r := r || CASE WHEN n = 1 THEN 'PASS  a visitor can read the alias (needed to map typing)' ELSE 'FAIL  alias not readable' END || E'\n';

  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'PROBE RESULTS %(everything above was rolled back)', r;
END $$;
