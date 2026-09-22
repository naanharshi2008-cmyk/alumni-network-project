-- =============================================================================
-- Veveaham Alumni - Migration 20: closing the old holes
-- =============================================================================
-- Two things older than Round 10 that Round 10's rules made visible:
--
-- 1. higher_studies and work_experience let their owner write at any time.
--    Every other part of a published profile changes only through review -
--    the guard trigger's rule for alumni, and migration 18's for the new
--    lists - and the profile editor has staged these since round 6. The
--    table still allowed a direct write. Now: the owner reads their own rows
--    always, and writes them only before the profile is published.
--
-- 2. public_alumni still handed out exact ranks and marks. Every page has
--    shown them only as bands since round 4, but the data behind the page did
--    not, and an anonymous request read the exact number. The view now
--    publishes the band edge instead, which the same formatters print as the
--    same label - so nothing on any page changes. The person, the school and
--    the review screen still read the exact value from the table.
--
-- Also: merging a value now moves its case variants too ("Btech" to
-- "BTech"), which migration 19's merge renamed on the list but not on the
-- profiles.
--
-- REQUIRES 18 (the helpers, owns_*), 19 (admin_merge_option). One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. The old timelines follow the same rule as the new lists
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Alumni manage own higher studies" ON public.higher_studies;
DROP POLICY IF EXISTS "Alumni manage own work experience" ON public.work_experience;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['higher_studies', 'work_experience'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owner reads own" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner reads own" ON public.%I FOR SELECT TO authenticated USING (public.owns_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner adds before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner adds before publish" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.owns_unpublished_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner edits before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner edits before publish" ON public.%I FOR UPDATE TO authenticated USING (public.owns_unpublished_alumnus(alumni_id)) WITH CHECK (public.owns_unpublished_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner removes before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner removes before publish" ON public.%I FOR DELETE TO authenticated USING (public.owns_unpublished_alumnus(alumni_id))', t);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Scores as bands in the public view
-- -----------------------------------------------------------------------------
-- The floor of the marks band formatMarksBand draws: 95+, 90, 85, 80, then
-- tens down to 50, and 0 for "under 50%".
CREATE OR REPLACE FUNCTION public.marks_band_floor(p numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL OR p < 0 OR p > 100 THEN NULL
    WHEN p >= 95 THEN 95 WHEN p >= 90 THEN 90 WHEN p >= 85 THEN 85 WHEN p >= 80 THEN 80
    WHEN p >= 50 THEN floor(p / 10) * 10
    ELSE 0
  END
$$;

-- 18's view, column for column; only the two score columns change.
CREATE OR REPLACE VIEW public_alumni AS
SELECT
  a.id,
  a.full_name,
  a.username,
  a.public_slug,
  a.school_name,
  a.school_board,
  a.class_of,
  a.stream,
  a.degree,
  a.branch,
  a.field,
  a.current_status,
  a.currently_at,
  a.designation,
  a.expected_finish_year,
  a.admission_route,
  -- A band edge, never the rank: formatRankBand(edge) prints exactly the label
  -- formatRankBand(rank) would (lib/text.ts).
  CASE WHEN regexp_replace(coalesce(a.admission_rank, ''), '\D', '', 'g') ~ '^[0-9]{1,9}$'
       THEN public.rank_band_edge(regexp_replace(a.admission_rank, '\D', '', 'g')::int)::text END AS admission_rank,
  -- The floor of the marks band, never the marks: formatMarksBand(floor)
  -- prints the same range formatMarksBand(marks) would.
  CASE WHEN nullif(regexp_replace(coalesce(a.board_marks, ''), '[^0-9.]', '', 'g'), '') ~ '^[0-9]+(\.[0-9]+)?$'
       THEN public.marks_band_floor(regexp_replace(a.board_marks, '[^0-9.]', '', 'g')::numeric)::text END AS board_marks,
  a.board_cutoff,
  a.linkedin_url,
  a.message_1,
  a.message_2,
  a.show_photo,
  CASE WHEN a.show_photo THEN a.photo_url ELSE NULL END AS photo_url,
  a.college_id,
  a.organization_id,
  a.college_name_raw,
  a.created_at,
  a.last_updated,
  a.last_confirmed_at,
  a.school_note,
  a.college_thoughts,
  a.professional_course,
  a.professional_stage,
  a.professional_org,
  a.featured,
  CASE WHEN c.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',             c.name,
      'state',            c.state,
      'district',         c.district,
      'website',          c.website,
      'university_name',  c.university_name,
      'management_type',  c.management_type,
      'established_year', c.established_year,
      'is_engineering',   c.is_engineering,
      'banner_url',       c.banner_url,
      'logo_url',         c.logo_url,
      'banner_credit',    c.banner_credit,
      'description',      c.description,
      'aliases',          coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                                    FROM institute_aliases ia WHERE ia.college_id = c.id), '[]'::jsonb)
    )
  END AS colleges,
  CASE WHEN o.id IS NULL THEN NULL ELSE
    jsonb_build_object(
      'name',    o.name,
      'aliases', coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                           FROM institute_aliases ia WHERE ia.organization_id = o.id), '[]'::jsonb)
    )
  END AS organization,
  a.admission_kind,
  a.admission_exam,
  a.admission_detail,
  a.linkedin_handle
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
LEFT JOIN organizations o ON o.id = a.organization_id
WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;


GRANT SELECT ON public_alumni TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. Merging moves the survivor's case variants too
-- -----------------------------------------------------------------------------
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

    -- The survivor's own case variants ("Snucee" when the name is "SNUCEE")
    -- are the same value to every index, so they move without folding.
    UPDATE public.alumni SET admission_exam = display
     WHERE admission_kind = 'entrance_exam' AND public.norm_text(admission_exam) = public.norm_text(display) AND admission_exam <> display;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;
    UPDATE public.exam_attempts SET exam = display WHERE public.norm_text(exam) = public.norm_text(display) AND exam <> display;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;
    UPDATE public.admits SET exam = display WHERE public.norm_text(exam) = public.norm_text(display) AND exam <> display;
    GET DIAGNOSTICS n = ROW_COUNT; moved := moved + n;
    UPDATE public.gap_years SET exam = display WHERE public.norm_text(exam) = public.norm_text(display) AND exam <> display;
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
    -- Every spelling merged away, and the survivor's own case variants: a
    -- correction of case alone ("Btech" to "BTech") has nothing in `froms`,
    -- and used to rename the list entry while leaving the profiles as typed.
    EXECUTE format('UPDATE public.alumni SET %I = $1 WHERE public.norm_text(%I) = ANY($2) OR (public.norm_text(%I) = public.norm_text($1) AND %I <> $1)', col, col, col, col)
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
      EXECUTE format('UPDATE public.admits SET %I = $1 WHERE public.norm_text(%I) = ANY($2) OR (public.norm_text(%I) = public.norm_text($1) AND %I <> $1)', col, col, col, col)
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


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK, in one transaction: restore 19's admin_merge_option and 18's
-- public_alumni; DROP FUNCTION marks_band_floor(numeric); drop the four
-- "Owner ..." policies on higher_studies and work_experience and recreate
--   "Alumni manage own higher studies" / "Alumni manage own work experience"
--   FOR ALL TO authenticated USING (public.owns_alumnus(alumni_id))
--   WITH CHECK (public.owns_alumnus(alumni_id)).
-- =============================================================================
