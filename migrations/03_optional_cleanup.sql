-- =============================================================================
-- Veveaham Alumni Network — OPTIONAL cosmetic cleanup
-- =============================================================================
-- Not required for the privacy fix, and not part of the phased deploy. Run it
-- whenever you like — before or after the other migrations, it makes no
-- difference. It only tidies text that is currently visible on the site.
--
-- Safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. College names imported with literal quote marks
-- -----------------------------------------------------------------------------
-- The bulk CSV import wrapped some names in double quotes, so the College
-- Explorer currently renders entries like:
--
--   "Charak Institute of Pharmacy, Choli Road, Mandleshwar Block  Maheshwar, ..."
--
-- 52 rows in `colleges` are affected, 3 of which are linked to an alumnus and
-- therefore visible on the public site today. This strips the surrounding
-- quotes and collapses the doubled spaces the same import left behind.

UPDATE colleges
SET name = regexp_replace(btrim(btrim(name), '"'), '\s+', ' ', 'g')
WHERE name LIKE '"%' OR name LIKE '%"';

-- Check afterwards — expect zero rows:
-- SELECT id, name FROM colleges WHERE name LIKE '"%' OR name LIKE '%"';


-- -----------------------------------------------------------------------------
-- 2. What this deliberately does NOT do
-- -----------------------------------------------------------------------------
-- Many imported names carry a full postal address, e.g.
--   'Charak Institute of Pharmacy, Choli Road, Mandleshwar Block Maheshwar, Khargone 451221'
-- when the useful name is just 'Charak Institute of Pharmacy'.
--
-- Trimming at the first comma would fix those but would also wreck legitimate
-- names where the comma carries meaning ('St. Xavier's College, Mumbai'), so it
-- is left alone rather than automated. Fix them individually from the admin
-- dashboard's "Unmatched Colleges" tab, which rewrites the name for every
-- student linked to it at once.
-- =============================================================================
