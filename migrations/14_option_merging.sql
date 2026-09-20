-- =============================================================================
-- Veveaham Alumni - Migration 14: one name per thing, with its old spellings
-- =============================================================================
-- Institutes already work this way (migration 10): one display name, any number
-- of aliases, and a merge that moves everyone onto the survivor. The dropdown
-- values never got the same treatment, and it shows: five profiles say
-- "IAT  (IISER Aptitude Test)" with two spaces while a sixth says "IISER
-- Aptitude Test", so the directory filter offers both as if they were different
-- exams.
--
-- admin_merge_option does for a value what merge_institute does for a college:
--   - every profile using an old spelling moves to the display name,
--   - staged edits move too, so approving one cannot undo the merge,
--   - each old spelling is kept as an alias of the display name, so the same
--     typing next year maps itself instead of splitting the list again.
--
-- An alias is an ordinary field_options row with canonical_value set. It stays
-- publicly readable - the registration form needs it to map what someone types
-- - but it is filtered out of the dropdowns, which show display names only.
--
-- REQUIRES 07 (is_school_admin) and 10 (assert_school_admin).
-- Additive. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- Which column a category of value actually lives in
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.option_column(p_category text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_category
    WHEN 'stream'              THEN 'stream'
    WHEN 'degree'              THEN 'degree'
    WHEN 'admission_route'     THEN 'admission_route'
    WHEN 'current_status'      THEN 'current_status'
    WHEN 'field'               THEN 'field'
    WHEN 'professional_course' THEN 'professional_course'
  END
$$;


-- -----------------------------------------------------------------------------
-- Merge spellings into one display name
-- -----------------------------------------------------------------------------
-- `p_into` is what the public sees, and may be a name that does not exist yet:
-- that is how "IAT  (IISER Aptitude Test)" is repaired to "IAT (IISER Aptitude
-- Test)" - a rename is simply a merge of one spelling into a tidier one.
CREATE OR REPLACE FUNCTION public.admin_merge_option(p_category text, p_from text[], p_into text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  col        text := public.option_column(p_category);
  display    text := btrim(regexp_replace(coalesce(p_into, ''), '\s+', ' ', 'g'));
  froms      text[];
  moved      int := 0;
  staged     int := 0;
  alias_rows int := 0;
  v          text;
BEGIN
  PERFORM public.assert_school_admin();
  IF col IS NULL THEN RAISE EXCEPTION 'That is not a kind of value we keep lists for.'; END IF;
  IF char_length(display) < 1 THEN RAISE EXCEPTION 'Give the name to keep.'; END IF;
  IF char_length(display) > 120 THEN RAISE EXCEPTION 'That name is too long.'; END IF;

  -- The display name is never its own alias, and blanks are not spellings.
  SELECT array_agg(DISTINCT x) INTO froms
    FROM unnest(coalesce(p_from, '{}'::text[])) AS x
   WHERE btrim(x) <> '' AND x <> display;
  froms := coalesce(froms, '{}'::text[]);

  -- 1. Live profiles.
  EXECUTE format('UPDATE public.alumni SET %I = $1 WHERE %I = ANY($2)', col, col)
    USING display, froms;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- 2. Edits waiting for review, so publishing one later cannot resurrect an
  --    old spelling. The column name is data here, not SQL, so no format().
  UPDATE public.alumni
     SET pending_changes = jsonb_set(pending_changes, ARRAY[col], to_jsonb(display))
   WHERE pending_changes IS NOT NULL
     AND pending_changes ? col
     AND pending_changes->>col = ANY(froms);
  GET DIAGNOSTICS staged = ROW_COUNT;

  -- 3. The display name is a real, approved option.
  INSERT INTO public.field_options (category, value, status, canonical_value)
  VALUES (p_category, display, 'approved', NULL)
  ON CONFLICT (category, lower(value))
  DO UPDATE SET status = 'approved', canonical_value = NULL, value = EXCLUDED.value;

  -- 4. Every old spelling points at it from now on.
  FOREACH v IN ARRAY froms LOOP
    INSERT INTO public.field_options (category, value, status, canonical_value)
    VALUES (p_category, v, 'approved', display)
    ON CONFLICT (category, lower(value))
    DO UPDATE SET canonical_value = display, status = 'approved';
    alias_rows := alias_rows + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'display', display, 'moved_profiles', moved, 'moved_staged_edits', staged, 'aliases', alias_rows);
END
$$;

REVOKE ALL ON FUNCTION public.admin_merge_option(text, text[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_merge_option(text, text[], text) TO authenticated;


-- -----------------------------------------------------------------------------
-- Undo an alias
-- -----------------------------------------------------------------------------
-- Forgetting an alias only stops future mapping; profiles already moved stay
-- moved, which is why this is a separate, deliberate act rather than a toggle.
CREATE OR REPLACE FUNCTION public.admin_forget_alias(p_category text, p_value text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_school_admin();
  DELETE FROM public.field_options
   WHERE category = p_category
     AND lower(value) = lower(btrim(p_value))
     AND canonical_value IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION public.admin_forget_alias(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_forget_alias(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: DROP FUNCTION admin_forget_alias(text, text),
-- admin_merge_option(text, text[], text), option_column(text). Merged profiles
-- keep the display name they were moved to; aliases can be deleted with
-- DELETE FROM field_options WHERE canonical_value IS NOT NULL.
-- =============================================================================
