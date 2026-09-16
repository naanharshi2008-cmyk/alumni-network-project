-- =============================================================================
-- Veveaham Alumni — Migration 09: searchable institute names (the heavy part)
-- =============================================================================
-- Adds normalised keys to colleges and organizations so "IIT Madras",
-- "IITMadras" and "I.I.T. Madras" are one name, and a trigram index so typos
-- ("Thiruvanathapuram") still find the right row.
--
-- HEAVY: adding stored generated columns rewrites the 47,597-row colleges table
-- (seconds, but it holds a lock meanwhile). Run at a quiet time. lock_timeout
-- makes it give up cleanly instead of queueing behind a busy table.
--
-- Additive: the current site keeps working after this runs. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
-- Supabase already grants this; stated so search works wherever this runs.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 1. Normalisers (mirrored exactly in lib/instituteKey.ts)
-- -----------------------------------------------------------------------------
-- inst_norm: lowercase words separated by single spaces.
--   "St. Joseph's College"        -> "st josephs college"
--   "Govt. Arts & Science College" -> "government arts and science college"
--   "I I T Madras"                -> "iit madras"   (spaced letters joined)
CREATE OR REPLACE FUNCTION public.inst_norm(p text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(p), '&', ' and ', 'g'),
              '[''’‘`]', '', 'g'),
            '[^a-z0-9]+', ' ', 'g'),
          '\mgovt\M', 'government', 'g'),
        '\mengg\M', 'engineering', 'g'),
      '\muniv\M', 'university', 'g'),
    '\m([a-z]) (?=[a-z]( |$))', '\1', 'g')
  )
$$;

-- inst_key: the same without spaces, so spacing never matters.
CREATE OR REPLACE FUNCTION public.inst_key(p text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$ SELECT replace(public.inst_norm(p), ' ', '') $$;

-- inst_query_acronyms: applied to a SEARCH QUERY only (never to all 47k rows,
-- where 2-3 letter initials collide by the hundreds). For a query of 3+
-- significant words it returns the full initials and "initials + last word":
--   "indian institute of technology madras" -> {iitm, iitmadras}
CREATE OR REPLACE FUNCTION public.inst_query_acronyms(p_norm text)
RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  WITH w AS (
    SELECT array_agg(word ORDER BY ord) AS words
    FROM unnest(string_to_array(p_norm, ' ')) WITH ORDINALITY AS t(word, ord)
    WHERE word <> '' AND word NOT IN ('of', 'and', 'the', 'for', 'at', 'in')
  )
  SELECT CASE
    WHEN coalesce(array_length(words, 1), 0) < 3 THEN '{}'::text[]
    ELSE ARRAY[
      (SELECT string_agg(left(x, 1), '') FROM unnest(words) AS x),
      (SELECT string_agg(left(x, 1), '') FROM unnest(words[1:array_length(words, 1) - 1]) AS x)
        || words[array_length(words, 1)]
    ]
  END
  FROM w
$$;


-- -----------------------------------------------------------------------------
-- 2. Keys, merge pointer and indexes
-- -----------------------------------------------------------------------------
-- merged_into: a duplicate row points at the row that replaced it. Merged rows
-- are never deleted (history, and old links), just hidden from search.
ALTER TABLE public.colleges
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.colleges(id),
  ADD COLUMN IF NOT EXISTS name_norm text GENERATED ALWAYS AS (public.inst_norm(name)) STORED,
  ADD COLUMN IF NOT EXISTS name_key  text GENERATED ALWAYS AS (public.inst_key(name)) STORED;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS name_norm text GENERATED ALWAYS AS (public.inst_norm(name)) STORED,
  ADD COLUMN IF NOT EXISTS name_key  text GENERATED ALWAYS AS (public.inst_key(name)) STORED;

DO $$ BEGIN
  ALTER TABLE public.colleges ADD CONSTRAINT colleges_not_merged_into_self CHECK (merged_into IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.organizations ADD CONSTRAINT organizations_not_merged_into_self CHECK (merged_into IS DISTINCT FROM id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS colleges_name_key_idx       ON public.colleges (name_key);
CREATE INDEX IF NOT EXISTS colleges_name_key_trgm_idx  ON public.colleges USING gin (name_key extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS colleges_name_norm_trgm_idx ON public.colleges USING gin (name_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS colleges_merged_into_idx    ON public.colleges (merged_into) WHERE merged_into IS NOT NULL;
CREATE INDEX IF NOT EXISTS organizations_name_key_idx  ON public.organizations (name_key);

-- =============================================================================
-- ROLLBACK: DROP the three indexes; ALTER TABLE ... DROP COLUMN name_key,
-- name_norm (instant); DROP COLUMN merged_into only if no merge has happened;
-- then DROP FUNCTION inst_query_acronyms, inst_key, inst_norm.
-- =============================================================================
