-- =============================================================================
-- Veveaham Alumni — Migration 10: institute aliases, search and merging
-- =============================================================================
-- One institute, one display name, any number of aliases ("IIT Madras" =
-- "IITM" = "Indian Institute of Technology Madras"), plus:
--   search_institutes()  ranked, typo-tolerant search for the type-ahead
--   resolve_institute()  an id only when a typed name is unambiguous
--   admin_link_alumni()  links typed names AND remembers the spelling
--   merge_institute()    folds a duplicate into its survivor
--   admin_create_institute(), admin_rename_institute()
--
-- REQUIRES migrations 07 (is_school_admin), 08 (public_slug) and 09 (keys).
-- Additive: the current site keeps working. One transaction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Aliases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institute_aliases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid REFERENCES public.colleges(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  alias           text NOT NULL CHECK (char_length(alias) <= 200),
  source          text NOT NULL DEFAULT 'admin'
                  CHECK (source IN ('short_names', 'seed', 'admin', 'learned', 'renamed', 'merged')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  kind            text GENERATED ALWAYS AS (CASE WHEN college_id IS NOT NULL THEN 'college' ELSE 'organization' END) STORED,
  entity_id       uuid GENERATED ALWAYS AS (coalesce(college_id, organization_id)) STORED,
  alias_norm      text GENERATED ALWAYS AS (public.inst_norm(alias)) STORED,
  alias_key       text GENERATED ALWAYS AS (public.inst_key(alias)) STORED,
  CONSTRAINT institute_aliases_one_target CHECK (num_nonnulls(college_id, organization_id) = 1),
  CONSTRAINT institute_aliases_key_length CHECK (char_length(public.inst_key(alias)) >= 2)
);

-- An alias key may belong to several institutes ("CIT" is more than one
-- college); ambiguity is handled where names are resolved, not here.
CREATE UNIQUE INDEX IF NOT EXISTS institute_aliases_entity_key ON public.institute_aliases (entity_id, alias_key);
CREATE INDEX IF NOT EXISTS institute_aliases_kind_key  ON public.institute_aliases (kind, alias_key);
CREATE INDEX IF NOT EXISTS institute_aliases_norm_trgm ON public.institute_aliases USING gin (alias_norm extensions.gin_trgm_ops);

ALTER TABLE public.institute_aliases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.institute_aliases TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.institute_aliases TO authenticated;

DROP POLICY IF EXISTS "Aliases are public" ON public.institute_aliases;
CREATE POLICY "Aliases are public" ON public.institute_aliases
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage aliases" ON public.institute_aliases;
CREATE POLICY "Admins manage aliases" ON public.institute_aliases
  FOR ALL TO authenticated USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());

-- The few short_names the import carried ("VIT, VIT Vellore, …").
INSERT INTO public.institute_aliases (college_id, alias, source)
SELECT c.id, btrim(part), 'short_names'
FROM public.colleges c
CROSS JOIN LATERAL unnest(string_to_array(c.short_names, ',')) AS part
WHERE c.short_names IS NOT NULL
  AND char_length(public.inst_key(btrim(part))) >= 2
  AND public.inst_key(btrim(part)) <> c.name_key
ON CONFLICT (entity_id, alias_key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. One view over both kinds of institute
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.institutes WITH (security_invoker = true) AS
SELECT 'college'::text AS kind, id, name, name_key, name_norm, state, district,
       coalesce(added_by_admin, false) AS added_by_admin, merged_into
FROM public.colleges
UNION ALL
SELECT 'organization'::text, id, name, name_key, name_norm, NULL::text, NULL::text,
       coalesce(added_by_admin, false), merged_into
FROM public.organizations;

GRANT SELECT ON public.institutes TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. Links always land on a surviving institute
-- -----------------------------------------------------------------------------
-- merge_institute() keeps merge chains flat, so one step is enough.
CREATE OR REPLACE FUNCTION public.alumni_follow_merges()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.college_id IS NOT NULL THEN
    NEW.college_id := coalesce((SELECT merged_into FROM colleges WHERE id = NEW.college_id), NEW.college_id);
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    NEW.organization_id := coalesce((SELECT merged_into FROM organizations WHERE id = NEW.organization_id), NEW.organization_id);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS alumni_follow_merges ON public.alumni;
CREATE TRIGGER alumni_follow_merges
  BEFORE INSERT OR UPDATE OF college_id, organization_id ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.alumni_follow_merges();


-- -----------------------------------------------------------------------------
-- 4. search_institutes: ranked, typo-tolerant, duplicates collapsed
-- -----------------------------------------------------------------------------
-- Tiers, best first (short queries only ever reach the first):
--   4 exact    name or alias key equals the query key            (2+ chars)
--   3 prefix   key starts with the query key                     (3+ chars)
--   2 acronym  "Indian Institute of Technology Madras" -> iitmadras (3+ words)
--   1 contains key contains the query, or its words in order     (4+ chars)
--   0 fuzzy    trigram word similarity - only when nothing matched exactly,
--              by prefix or by acronym, and the tiers above leave room: a
--              typo needs it, a correct name would only gain noise from it
-- Within a tier: similarity, then how many of OUR alumni are there, then
-- admin-added, then the shorter name.
CREATE OR REPLACE FUNCTION public.search_institutes(p_query text, p_kind text DEFAULT 'college', p_limit int DEFAULT 10)
RETURNS TABLE (id uuid, name text, state text, district text, matched_alias text, match_kind text, score real)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  q_norm text := coalesce(public.inst_norm(left(coalesce(p_query, ''), 100)), '');
  q_key  text := replace(q_norm, ' ', '');
  q_like text := '%' || replace(q_norm, ' ', '%') || '%';
  q_acr  text[] := coalesce(public.inst_query_acronyms(q_norm), '{}');
  lim    int := least(greatest(coalesce(p_limit, 10), 1), 20);
BEGIN
  IF p_kind NOT IN ('college', 'organization') OR char_length(q_key) < 2 THEN
    RETURN;
  END IF;
  PERFORM set_config('pg_trgm.word_similarity_threshold', '0.5', true);

  RETURN QUERY
  WITH strong AS (
    (SELECT i.id, NULL::text AS alias, 'exact'::text AS mk, 4 AS tier
       FROM institutes i
      WHERE i.kind = p_kind AND i.merged_into IS NULL AND i.name_key = q_key
      LIMIT 50)
    UNION ALL
    (SELECT i.id, a.alias, 'exact', 4
       FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind
      WHERE a.kind = p_kind AND a.alias_key = q_key AND i.merged_into IS NULL
      LIMIT 50)
    UNION ALL
    (SELECT i.id, NULL, 'prefix', 3
       FROM institutes i
      WHERE char_length(q_key) >= 3 AND i.kind = p_kind AND i.merged_into IS NULL
        AND i.name_key LIKE q_key || '%'
      ORDER BY char_length(i.name) LIMIT 50)
    UNION ALL
    (SELECT i.id, a.alias, 'prefix', 3
       FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind
      WHERE char_length(q_key) >= 3 AND a.kind = p_kind AND i.merged_into IS NULL
        AND a.alias_key LIKE q_key || '%'
      LIMIT 50)
    UNION ALL
    (SELECT i.id, NULL, 'acronym', 2
       FROM institutes i
      WHERE cardinality(q_acr) > 0 AND i.kind = p_kind AND i.merged_into IS NULL
        AND i.name_key = ANY (q_acr)
      LIMIT 50)
    UNION ALL
    (SELECT i.id, a.alias, 'acronym', 2
       FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind
      WHERE cardinality(q_acr) > 0 AND a.kind = p_kind AND i.merged_into IS NULL
        AND a.alias_key = ANY (q_acr)
      LIMIT 50)
    UNION ALL
    (SELECT i.id, NULL, 'contains', 1
       FROM institutes i
      WHERE char_length(q_key) >= 4 AND i.kind = p_kind AND i.merged_into IS NULL
        AND (i.name_key LIKE '%' || q_key || '%' OR i.name_norm LIKE q_like)
      ORDER BY char_length(i.name) LIMIT 50)
    UNION ALL
    (SELECT i.id, a.alias, 'contains', 1
       FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind
      WHERE char_length(q_key) >= 4 AND a.kind = p_kind AND i.merged_into IS NULL
        AND a.alias_key LIKE '%' || q_key || '%'
      LIMIT 50)
  ),
  fuzzy AS (
    (SELECT i.id, NULL::text AS alias, 'fuzzy'::text AS mk, 0 AS tier
       FROM institutes i
      WHERE char_length(q_key) >= 5
        AND NOT EXISTS (SELECT 1 FROM strong s WHERE s.tier >= 2)
        AND (SELECT count(DISTINCT s.id) FROM strong s) < lim
        AND i.kind = p_kind AND i.merged_into IS NULL
        AND q_norm OPERATOR(extensions.<%) i.name_norm
      ORDER BY extensions.word_similarity(q_norm, i.name_norm) DESC LIMIT 50)
    UNION ALL
    (SELECT i.id, a.alias, 'fuzzy', 0
       FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind
      WHERE char_length(q_key) >= 5
        AND NOT EXISTS (SELECT 1 FROM strong s WHERE s.tier >= 2)
        AND (SELECT count(DISTINCT s.id) FROM strong s) < lim
        AND a.kind = p_kind AND i.merged_into IS NULL
        AND q_norm OPERATOR(extensions.<%) a.alias_norm
      LIMIT 50)
  ),
  best AS (
    SELECT DISTINCT ON (c.id) c.id, c.alias, c.mk, c.tier
      FROM (SELECT * FROM strong UNION ALL SELECT * FROM fuzzy) c
     ORDER BY c.id, c.tier DESC, (c.alias IS NULL) DESC
  ),
  scored AS (
    SELECT b.id, i.name, i.state, i.district, i.name_key, b.alias, b.mk, b.tier, i.added_by_admin,
           greatest(extensions.word_similarity(q_norm, i.name_norm),
                    coalesce(extensions.word_similarity(q_norm, public.inst_norm(b.alias)), 0)) AS sim,
           (SELECT count(*) FROM public_alumni pa
             WHERE (p_kind = 'college' AND pa.college_id = b.id)
                OR (p_kind = 'organization' AND pa.organization_id = b.id)) AS alumni_count
      FROM best b JOIN institutes i ON i.id = b.id AND i.kind = p_kind
  ),
  -- Unmerged rows with the same name in the same place are one institute to
  -- a person searching: show it once.
  collapsed AS (
    SELECT DISTINCT ON (s.name_key, coalesce(s.state, ''), coalesce(s.district, '')) s.*
      FROM scored s
     ORDER BY s.name_key, coalesce(s.state, ''), coalesce(s.district, ''),
              s.tier DESC, s.alumni_count DESC, s.added_by_admin DESC, s.id
  )
  SELECT c.id, c.name, c.state, c.district, c.alias, c.mk, (c.tier + c.sim)::real
    FROM collapsed c
   ORDER BY c.tier DESC, round(c.sim::numeric, 1) DESC, c.alumni_count DESC,
            c.added_by_admin DESC, char_length(c.name), c.name
   LIMIT lim;
END
$$;

GRANT EXECUTE ON FUNCTION public.search_institutes(text, text, int) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. resolve_institute: an id only when a typed name means exactly one row
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_institute(p_kind text, p_text text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH k AS (SELECT coalesce(public.inst_key(left(coalesce(p_text, ''), 200)), '') AS key),
  hits AS (
    SELECT i.id FROM institutes i, k
     WHERE char_length(k.key) >= 2 AND i.kind = p_kind AND i.merged_into IS NULL AND i.name_key = k.key
    UNION
    SELECT i.id FROM institute_aliases a JOIN institutes i ON i.id = a.entity_id AND i.kind = a.kind, k
     WHERE char_length(k.key) >= 2 AND a.kind = p_kind AND i.merged_into IS NULL AND a.alias_key = k.key
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END FROM hits
$$;

GRANT EXECUTE ON FUNCTION public.resolve_institute(text, text) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6. Admin functions
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER, so row-level security still applies; the explicit check
-- turns a would-be silent no-op into a clear error. Trusted in the same way as
-- the guard trigger: admins, plus non-PostgREST roles (migrations, the editor).
CREATE OR REPLACE FUNCTION public.assert_school_admin()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT (public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated')) THEN
    RAISE EXCEPTION 'Only school administrators can do this.' USING ERRCODE = '42501';
  END IF;
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

    DELETE FROM institute_aliases a
     WHERE a.college_id = p_from
       AND EXISTS (SELECT 1 FROM institute_aliases b WHERE b.college_id = target AND b.alias_key = a.alias_key);
    UPDATE institute_aliases SET college_id = target WHERE college_id = p_from;
    INSERT INTO institute_aliases (college_id, alias, source)
    SELECT target, f.name, 'merged' FROM colleges f, colleges t
     WHERE f.id = p_from AND t.id = target AND f.name_key <> t.name_key AND char_length(f.name_key) >= 2
    ON CONFLICT (entity_id, alias_key) DO NOTHING;

    UPDATE colleges t SET banner_url = coalesce(t.banner_url, f.banner_url),
                          description = coalesce(t.description, f.description)
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

  RETURN jsonb_build_object('into', target, 'moved_alumni', moved_alumni, 'moved_staged_edits', moved_staged);
END
$$;

CREATE OR REPLACE FUNCTION public.admin_link_alumni(
  p_kind text, p_alumni_ids uuid[], p_entity_id uuid, p_typed text, p_remember boolean DEFAULT true)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid;
  target_key text;
  typed_key text := coalesce(public.inst_key(p_typed), '');
  n int := 0;
BEGIN
  PERFORM public.assert_school_admin();
  IF p_kind = 'college' THEN
    SELECT coalesce(merged_into, id) INTO target FROM colleges WHERE id = p_entity_id;
    IF target IS NULL THEN RAISE EXCEPTION 'That college no longer exists.'; END IF;
    SELECT name_key INTO target_key FROM colleges WHERE id = target;
    UPDATE alumni SET college_id = target WHERE id = ANY (p_alumni_ids) AND college_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{college_id}', to_jsonb(target::text))
     WHERE id = ANY (p_alumni_ids) AND pending_changes IS NOT NULL
       AND coalesce(pending_changes->>'college_id', '') = ''
       AND public.inst_key(pending_changes->>'college_name_raw') = typed_key;
  ELSIF p_kind = 'organization' THEN
    SELECT coalesce(merged_into, id) INTO target FROM organizations WHERE id = p_entity_id;
    IF target IS NULL THEN RAISE EXCEPTION 'That organisation no longer exists.'; END IF;
    SELECT name_key INTO target_key FROM organizations WHERE id = target;
    UPDATE alumni SET organization_id = target WHERE id = ANY (p_alumni_ids) AND organization_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE alumni SET pending_changes = jsonb_set(pending_changes, '{organization_id}', to_jsonb(target::text))
     WHERE id = ANY (p_alumni_ids) AND pending_changes IS NOT NULL
       AND coalesce(pending_changes->>'organization_id', '') = ''
       AND public.inst_key(pending_changes->>'currently_at') = typed_key;
  ELSE
    RAISE EXCEPTION 'Unknown institute kind.';
  END IF;

  IF n = 0 THEN
    RAISE EXCEPTION 'No profiles were linked — they may already be linked. Reload and try again.';
  END IF;

  -- Learn the spelling, so the next person who types it is matched at once.
  IF p_remember AND char_length(typed_key) >= 2 AND typed_key <> target_key THEN
    IF p_kind = 'college' THEN
      INSERT INTO institute_aliases (college_id, alias, source) VALUES (target, btrim(p_typed), 'learned')
      ON CONFLICT (entity_id, alias_key) DO NOTHING;
    ELSE
      INSERT INTO institute_aliases (organization_id, alias, source) VALUES (target, btrim(p_typed), 'learned')
      ON CONFLICT (entity_id, alias_key) DO NOTHING;
    END IF;
  END IF;
  RETURN n;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_create_institute(
  p_kind text, p_name text, p_state text DEFAULT NULL, p_district text DEFAULT NULL,
  p_allow_same_name boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  key text := coalesce(public.inst_key(clean), '');
  new_id uuid;
BEGIN
  PERFORM public.assert_school_admin();
  IF char_length(key) < 2 THEN RAISE EXCEPTION 'That name is too short.'; END IF;
  IF NOT p_allow_same_name AND EXISTS (
       SELECT 1 FROM institutes i WHERE i.kind = p_kind AND i.merged_into IS NULL AND i.name_key = key
       UNION ALL
       SELECT 1 FROM institute_aliases a WHERE a.kind = p_kind AND a.alias_key = key) THEN
    RAISE EXCEPTION 'An institute with that name already exists — link to it instead of creating another.'
      USING ERRCODE = '23505';
  END IF;

  IF p_kind = 'college' THEN
    INSERT INTO colleges (name, state, district, added_by_admin, status)
    VALUES (clean, nullif(btrim(p_state), ''), nullif(btrim(p_district), ''), true, 'approved')
    RETURNING id INTO new_id;
  ELSIF p_kind = 'organization' THEN
    INSERT INTO organizations (name, added_by_admin) VALUES (clean, true) RETURNING id INTO new_id;
  ELSE
    RAISE EXCEPTION 'Unknown institute kind.';
  END IF;
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_rename_institute(p_kind text, p_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  new_key text := coalesce(public.inst_key(clean), '');
  old_name text;
  old_key text;
BEGIN
  PERFORM public.assert_school_admin();
  IF char_length(new_key) < 2 THEN RAISE EXCEPTION 'That name is too short.'; END IF;

  IF p_kind = 'college' THEN
    SELECT name, name_key INTO old_name, old_key FROM colleges WHERE id = p_id AND merged_into IS NULL;
  ELSIF p_kind = 'organization' THEN
    SELECT name, name_key INTO old_name, old_key FROM organizations WHERE id = p_id AND merged_into IS NULL;
  ELSE
    RAISE EXCEPTION 'Unknown institute kind.';
  END IF;
  IF old_name IS NULL THEN RAISE EXCEPTION 'That institute no longer exists.'; END IF;

  IF new_key <> old_key AND EXISTS (
       SELECT 1 FROM institutes i WHERE i.kind = p_kind AND i.merged_into IS NULL AND i.id <> p_id AND i.name_key = new_key) THEN
    RAISE EXCEPTION 'Another institute already has that name — merge them instead.' USING ERRCODE = '23505';
  END IF;

  -- The old name keeps finding it.
  IF new_key <> old_key THEN
    IF p_kind = 'college' THEN
      INSERT INTO institute_aliases (college_id, alias, source) VALUES (p_id, old_name, 'renamed')
      ON CONFLICT (entity_id, alias_key) DO NOTHING;
      UPDATE colleges SET name = clean WHERE id = p_id;
    ELSE
      INSERT INTO institute_aliases (organization_id, alias, source) VALUES (p_id, old_name, 'renamed')
      ON CONFLICT (entity_id, alias_key) DO NOTHING;
      UPDATE organizations SET name = clean WHERE id = p_id;
    END IF;
    -- An alias identical to the new name would only duplicate it.
    DELETE FROM institute_aliases WHERE entity_id = p_id AND alias_key = new_key;
  ELSE
    IF p_kind = 'college' THEN UPDATE colleges SET name = clean WHERE id = p_id;
    ELSE UPDATE organizations SET name = clean WHERE id = p_id; END IF;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.assert_school_admin() FROM public;
REVOKE ALL ON FUNCTION public.merge_institute(text, uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.admin_link_alumni(text, uuid[], uuid, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.admin_create_institute(text, text, text, text, boolean) FROM public;
REVOKE ALL ON FUNCTION public.admin_rename_institute(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.assert_school_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_institute(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_alumni(text, uuid[], uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_institute(text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rename_institute(text, uuid, text) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Public view: aliases and the organisation, for alias-aware search
-- -----------------------------------------------------------------------------
-- STILL EXCLUDED: personal_email, phone_number, phone_country_code, email_key,
-- phone_key, admission_number, user_id, rejection_reason, pending_changes.
-- Institute keys, merged_into and alias sources are not exposed either.
DROP VIEW IF EXISTS public_alumni;

CREATE VIEW public_alumni AS
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
  a.admission_rank,
  a.board_marks,
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
  END AS organization
FROM alumni a
LEFT JOIN colleges c ON c.id = a.college_id
LEFT JOIN organizations o ON o.id = a.organization_id
WHERE a.approval_status = 'approved';

GRANT SELECT ON public_alumni TO anon, authenticated;

COMMENT ON VIEW public_alumni IS
  'Public, privacy-safe projection of approved alumni. Contact details are intentionally absent. The site reads this instead of the alumni table.';

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK: re-run the view block from 08; DROP TRIGGER alumni_follow_merges;
-- DROP FUNCTION the six functions above; DROP VIEW institutes;
-- DROP TABLE institute_aliases.
-- =============================================================================
