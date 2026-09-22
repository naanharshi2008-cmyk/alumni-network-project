-- =============================================================================
-- Veveaham Alumni - Migration 18: every path, not just the one taken
-- =============================================================================
-- Until now a person had exactly one admission: one `admission_route` text,
-- one rank, one set of marks. The school's own form sheets (202 responses over
-- two batches) showed that is not how students move through Class 12:
--
--   * a quarter wrote two or more entrance exams, up to six;
--   * 89 of 202 took no listed exam at all, and the form could not say whether
--     they joined on board marks, a management seat, or not at all;
--   * TNEA - counselling on board marks - was ticked as an "exam" 54 times;
--   * of 24 who wrote NEET, 8 are in medicine: attempted is not admitted;
--   * about one in twenty was repeating a year to try again.
--
-- This migration gives a path its real shape:
--
--   alumni.admission_kind      board_marks | entrance_exam | management | other
--   alumni.admission_exam      the exam, for entrance_exam
--   alumni.admission_detail    'TNEA' for counselling; the words for Other
--   exam_attempts              every exam written, with its outcome
--   admits                     every offer NOT taken (the joined seat stays on alumni)
--   gap_years + in_gap_year    a year out, preparing or on a break
--   alumni_private             parents and home address - never public
--   alumni_office_notes        the school's private notes
--
-- and one rule for who is publicly listed: approved, consent not refused, and
-- not in a current gap year. Everything public - the view, every public child
-- table - follows that one rule, so a hidden person is hidden everywhere.
--
-- `admission_route` stays, filled from the kind by a trigger, so every page
-- that reads it keeps working while the code moves over.
--
-- REQUIRES 02 (is_approved_alumnus), 07 (is_school_admin), 10 (institutes,
-- assert_school_admin), 13 (college_photos), 14 (option merging), 15 (the
-- guard trigger this replaces), 17 (public_alumni, merge_institute).
-- Additive. One transaction.
-- =============================================================================

SET LOCAL lock_timeout = '5s';


-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------

-- The one normalisation every comparison of a typed value uses.
CREATE OR REPLACE FUNCTION public.norm_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

-- The canonical name of an exam, or NULL when the vocabulary does not know it.
-- Case- and space-insensitive: field_options is unique on lower(value), so a
-- case-only alias ("Snucee") cannot be stored and does not need to be.
CREATE OR REPLACE FUNCTION public.exam_canonical(p text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(f.canonical_value, f.value)
    FROM field_options f
   WHERE f.category = 'exam' AND f.status = 'approved'
     AND public.norm_text(f.value) = public.norm_text(p)
   ORDER BY (f.canonical_value IS NULL) DESC
   LIMIT 1
$$;

-- The legacy mapping from a stored route to the new shape. Mirrored in
-- TypeScript as kindFromLegacyRoute() for drafts and the import.
CREATE OR REPLACE FUNCTION public.admission_from_route(
  p_route text, OUT kind text, OUT exam text, OUT detail text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  r text := btrim(coalesce(p_route, ''));
  n text := public.norm_text(p_route);
BEGIN
  kind := NULL; exam := NULL; detail := NULL;
  IF r = '' THEN RETURN; END IF;
  IF n IN ('board marks', 'merit / direct', 'merit/direct', 'merit', 'direct') THEN
    kind := 'board_marks'; RETURN;
  END IF;
  IF n = 'tnea' THEN kind := 'board_marks'; detail := 'TNEA'; RETURN; END IF;
  IF n IN ('management quota', 'management seat', 'management') THEN kind := 'management'; RETURN; END IF;
  exam := public.exam_canonical(r);
  IF exam IS NOT NULL THEN kind := 'entrance_exam'; RETURN; END IF;
  -- Sports Quota, Lateral Entry, CA / CS / CMA Foundation (not an exam, the
  -- owner decided) and anything typed: Other, with the words kept.
  kind := 'other'; detail := left(r, 120);
END
$$;

-- What `admission_route` reads for a given kind. 'TNEA' and 'Board Marks' are
-- the strings existing pages already understand.
CREATE OR REPLACE FUNCTION public.admission_label(p_kind text, p_exam text, p_detail text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'board_marks'   THEN CASE WHEN p_detail = 'TNEA' THEN 'TNEA' ELSE 'Board Marks' END
    WHEN 'entrance_exam' THEN p_exam
    WHEN 'management'    THEN 'Management seat'
    WHEN 'other'         THEN coalesce(nullif(btrim(p_detail), ''), 'Other')
  END
$$;

-- The username inside a LinkedIn link, or NULL when it is not one we trust.
CREATE OR REPLACE FUNCTION public.linkedin_handle_of(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN h ~ '^[a-z0-9_-]{3,100}$' THEN h END
    FROM (SELECT lower(substring(coalesce(p_url, '') FROM
            'linkedin\.com/(?:mwlite/)?in/([^/?#\s]+)')) AS h) x
$$;

-- The upper edge of the band a rank falls in. formatRankBand(edge) in
-- lib/text.ts prints exactly the label formatRankBand(rank) would, so a view
-- can publish the band without ever publishing the rank.
CREATE OR REPLACE FUNCTION public.rank_band_edge(r integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN r IS NULL OR r <= 0 THEN NULL
    WHEN r <= 100    THEN 100
    WHEN r <= 500    THEN 500
    WHEN r <= 1000   THEN 1000
    WHEN r <= 5000   THEN 5000
    WHEN r <= 10000  THEN 10000
    WHEN r <= 25000  THEN 25000
    WHEN r <= 50000  THEN 50000
    WHEN r <= 100000 THEN 100000
    ELSE 100001
  END
$$;

CREATE OR REPLACE FUNCTION public.percentile_band_floor(p numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL THEN NULL
              WHEN p >= 99 THEN 99 WHEN p >= 95 THEN 95 WHEN p >= 90 THEN 90
              WHEN p >= 80 THEN 80 ELSE 0 END
$$;

-- The academic year a date falls in, turning over in June: January 2026 is
-- still the 2025 year.
CREATE OR REPLACE FUNCTION public.current_academic_year()
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata') - interval '5 months')::int
$$;


-- -----------------------------------------------------------------------------
-- 2. The vocabularies: exams and branches, each with its areas
-- -----------------------------------------------------------------------------
-- An exam belongs to an area by itself - CLAT is Law even for someone who
-- joined engineering - so the area is data on the option, not a guess from
-- whoever wrote it. The keys mirror CATEGORIES in lib/types.ts.
ALTER TABLE public.field_options ADD COLUMN IF NOT EXISTS areas text[];

DO $$ BEGIN
  ALTER TABLE public.field_options ADD CONSTRAINT field_options_areas_check CHECK (
    areas IS NULL OR areas <@ ARRAY['engineering','medicine','nursing','pharmacy','sciences',
      'agriculture','commerce','management','law','architecture','design','computer_applications',
      'humanities','education','defence','other']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Canonical rows.
INSERT INTO public.field_options (category, value, status, canonical_value, areas)
SELECT 'exam', v, 'approved', NULL, a FROM (VALUES
  ('JEE Main',                   ARRAY['engineering','architecture']),
  ('JEE Advanced',               ARRAY['engineering','sciences']),
  ('NEET',                       ARRAY['medicine','nursing']),
  ('CUET',                       ARRAY['sciences','commerce','humanities','management']),
  ('BITSAT',                     ARRAY['engineering']),
  ('VITEEE',                     ARRAY['engineering']),
  ('SRMJEEE',                    ARRAY['engineering']),
  ('COMEDK',                     ARRAY['engineering']),
  ('KCET',                       ARRAY['engineering','agriculture','pharmacy']),
  ('MHT-CET',                    ARRAY['engineering','pharmacy','agriculture']),
  ('KEAM',                       ARRAY['engineering','pharmacy']),
  ('WBJEE',                      ARRAY['engineering']),
  ('AMRITAEEE',                  ARRAY['engineering']),
  ('SNUCEE',                     ARRAY['engineering']),
  ('SNUSAT',                     ARRAY['engineering','sciences','management','humanities']),
  ('KEE',                        ARRAY['engineering']),
  ('JET',                        ARRAY['engineering']),
  ('MET',                        ARRAY['engineering']),
  ('NIAT',                       ARRAY['engineering','computer_applications']),
  ('IAT (IISER Aptitude Test)',  ARRAY['sciences']),
  ('NEST',                       ARRAY['sciences']),
  ('CMI',                        ARRAY['sciences']),
  ('ISI',                        ARRAY['sciences']),
  ('CLAT',                       ARRAY['law']),
  ('NATA',                       ARRAY['architecture']),
  ('NDA',                        ARRAY['defence'])
) AS s(v, a)
ON CONFLICT (category, lower(value))
DO UPDATE SET status = 'approved', canonical_value = NULL,
              areas = coalesce(public.field_options.areas, EXCLUDED.areas);

-- The spellings students actually used, from the two form sheets.
INSERT INTO public.field_options (category, value, status, canonical_value)
SELECT 'exam', alias, 'approved', canonical FROM (VALUES
  ('JEE', 'JEE Main'), ('JEE Mains', 'JEE Main'), ('JEE (Main)', 'JEE Main'), ('JEE-Main', 'JEE Main'),
  ('JEE Adv', 'JEE Advanced'), ('JEE Advance', 'JEE Advanced'),
  ('NEET UG', 'NEET'), ('NEET-UG', 'NEET'), ('NEET (AYUSH)', 'NEET'),
  ('CUET UG', 'CUET'), ('CUET-UG', 'CUET'),
  ('VITEE', 'VITEEE'), ('VIT EEE', 'VITEEE'),
  ('SRMJEE', 'SRMJEEE'), ('SRM JEE', 'SRMJEEE'), ('SRM JEEE', 'SRMJEEE'),
  ('COMEDK UGET', 'COMEDK'),
  ('MHT CET', 'MHT-CET'), ('MHTCET', 'MHT-CET'),
  ('AEEE', 'AMRITAEEE'), ('Amrita EEE', 'AMRITAEEE'), ('Amrita AEEE', 'AMRITAEEE'),
  ('SNU CEE', 'SNUCEE'), ('SNU SAT', 'SNUSAT'),
  ('Karunya Entrance Examination', 'KEE'), ('KEE (Karunya)', 'KEE'),
  ('Jain Entrance Test', 'JET'), ('JET (Jain)', 'JET'),
  ('Manipal Entrance Test', 'MET'), ('MAHE', 'MET'),
  ('IAT', 'IAT (IISER Aptitude Test)'), ('IISER', 'IAT (IISER Aptitude Test)'),
  ('IISER Aptitude Test', 'IAT (IISER Aptitude Test)')
) AS s(alias, canonical)
ON CONFLICT (category, lower(value)) DO NOTHING;

-- Branches. "CS" and "CA" are deliberately never aliased: "CS" is Computer
-- Science under a BE or BSc but Corporate Secretaryship under a BCom, and "CA"
-- is Computer Applications in a BCom but Chartered Accountancy on its own -
-- both readings appear in the sheets. The form resolves those two with the
-- degree in view.
INSERT INTO public.field_options (category, value, status, canonical_value, areas)
SELECT 'branch', v, 'approved', NULL, a FROM (VALUES
  ('Computer Science and Engineering',              ARRAY['engineering']),
  ('Information Technology',                        ARRAY['engineering','computer_applications']),
  ('Electronics and Communication Engineering',     ARRAY['engineering']),
  ('Electrical and Electronics Engineering',        ARRAY['engineering']),
  ('Mechanical Engineering',                        ARRAY['engineering']),
  ('Civil Engineering',                             ARRAY['engineering']),
  ('Artificial Intelligence and Data Science',      ARRAY['engineering']),
  ('Artificial Intelligence and Machine Learning',  ARRAY['engineering']),
  ('CSE (Artificial Intelligence and Machine Learning)', ARRAY['engineering']),
  ('CSE (Cyber Security)',                          ARRAY['engineering']),
  ('Computer Science and Business Systems',         ARRAY['engineering']),
  ('Computer and Communication Engineering',        ARRAY['engineering']),
  ('Electronics and Computer Engineering',          ARRAY['engineering']),
  ('Electronics and Instrumentation Engineering',   ARRAY['engineering']),
  ('Instrumentation and Control Engineering',       ARRAY['engineering']),
  ('VLSI Design',                                   ARRAY['engineering']),
  ('Biotechnology',                                 ARRAY['engineering','sciences']),
  ('Biomedical Engineering',                        ARRAY['engineering']),
  ('Aeronautical Engineering',                      ARRAY['engineering']),
  ('Aerospace Engineering',                         ARRAY['engineering']),
  ('Automobile Engineering',                        ARRAY['engineering']),
  ('Mechatronics',                                  ARRAY['engineering']),
  ('Production Engineering',                        ARRAY['engineering']),
  ('Chemical Engineering',                          ARRAY['engineering']),
  ('Robotics and Automation',                       ARRAY['engineering']),
  ('Agricultural Engineering',                      ARRAY['engineering','agriculture']),
  ('Food Technology',                               ARRAY['engineering']),
  ('Textile Technology',                            ARRAY['engineering']),
  ('Fashion Technology',                            ARRAY['engineering','design']),
  ('Physics',                                       ARRAY['sciences']),
  ('Chemistry',                                     ARRAY['sciences']),
  ('Mathematics',                                   ARRAY['sciences']),
  ('Computer Science',                              ARRAY['sciences','computer_applications']),
  ('Computer Science with Data Analytics',          ARRAY['sciences','computer_applications']),
  ('Computer Science with Cognitive Systems',       ARRAY['sciences','computer_applications']),
  ('Data Science',                                  ARRAY['sciences','computer_applications']),
  ('Statistics',                                    ARRAY['sciences']),
  ('Biochemistry',                                  ARRAY['sciences']),
  ('Microbiology',                                  ARRAY['sciences']),
  ('Zoology',                                       ARRAY['sciences']),
  ('Botany',                                        ARRAY['sciences']),
  ('Home Science',                                  ARRAY['sciences']),
  ('Nutrition and Dietetics',                       ARRAY['sciences']),
  ('Agriculture',                                   ARRAY['agriculture']),
  ('Nursing',                                       ARRAY['nursing']),
  ('Radiology and Imaging Technology',              ARRAY['nursing']),
  ('Cardiac Technology',                            ARRAY['nursing']),
  ('Occupational Therapy',                          ARRAY['nursing']),
  ('Physician Assistant',                           ARRAY['nursing']),
  ('Computer Applications',                         ARRAY['commerce','computer_applications']),
  ('Professional Accounting',                       ARRAY['commerce']),
  ('Corporate Secretaryship',                       ARRAY['commerce']),
  ('Accounting and Finance',                        ARRAY['commerce']),
  ('Banking and Insurance',                         ARRAY['commerce']),
  ('Business Process Services',                     ARRAY['commerce']),
  ('Logistics',                                     ARRAY['management']),
  ('International Business',                        ARRAY['management']),
  ('Economics',                                     ARRAY['humanities','commerce']),
  ('English',                                       ARRAY['humanities']),
  ('Psychology',                                    ARRAY['humanities']),
  ('Visual Communication',                          ARRAY['design','humanities']),
  ('Costume Design and Fashion',                    ARRAY['design'])
) AS s(v, a)
ON CONFLICT (category, lower(value))
DO UPDATE SET status = 'approved', canonical_value = NULL,
              areas = coalesce(public.field_options.areas, EXCLUDED.areas);

INSERT INTO public.field_options (category, value, status, canonical_value)
SELECT 'branch', alias, 'approved', canonical FROM (VALUES
  ('CSE', 'Computer Science and Engineering'), ('C.S.E', 'Computer Science and Engineering'),
  ('Computer Science Engineering', 'Computer Science and Engineering'),
  ('Computer Science & Engineering', 'Computer Science and Engineering'),
  ('IT', 'Information Technology'),
  ('ECE', 'Electronics and Communication Engineering'),
  ('Electronics and Communication', 'Electronics and Communication Engineering'),
  ('Electronics & Communication Engineering', 'Electronics and Communication Engineering'),
  ('EEE', 'Electrical and Electronics Engineering'),
  ('Electrical & Electronics Engineering', 'Electrical and Electronics Engineering'),
  ('Mech', 'Mechanical Engineering'), ('Mechanical', 'Mechanical Engineering'),
  ('Civil', 'Civil Engineering'),
  ('AIDS', 'Artificial Intelligence and Data Science'), ('AI&DS', 'Artificial Intelligence and Data Science'),
  ('AI & DS', 'Artificial Intelligence and Data Science'), ('AI DS', 'Artificial Intelligence and Data Science'),
  ('AI and Data Science', 'Artificial Intelligence and Data Science'),
  ('AIML', 'Artificial Intelligence and Machine Learning'), ('AI&ML', 'Artificial Intelligence and Machine Learning'),
  ('AI & ML', 'Artificial Intelligence and Machine Learning'),
  ('CSE (AIML)', 'CSE (Artificial Intelligence and Machine Learning)'),
  ('CSE AIML', 'CSE (Artificial Intelligence and Machine Learning)'),
  ('CSE (AI&ML)', 'CSE (Artificial Intelligence and Machine Learning)'),
  ('Cyber Security', 'CSE (Cyber Security)'), ('Cybersecurity', 'CSE (Cyber Security)'),
  ('CSE Cyber Security', 'CSE (Cyber Security)'), ('CSE (Cybersecurity)', 'CSE (Cyber Security)'),
  ('CSBS', 'Computer Science and Business Systems'),
  ('CCE', 'Computer and Communication Engineering'),
  ('EIE', 'Electronics and Instrumentation Engineering'),
  ('ICE', 'Instrumentation and Control Engineering'),
  ('VLSI', 'VLSI Design'),
  ('Biotech', 'Biotechnology'),
  ('Aero', 'Aeronautical Engineering'),
  ('Maths', 'Mathematics'),
  ('PA', 'Professional Accounting'),
  ('A&F', 'Accounting and Finance'),
  ('BPS', 'Business Process Services'),
  ('Viscom', 'Visual Communication'),
  ('CDF', 'Costume Design and Fashion'),
  ('Agri', 'Agriculture')
) AS s(alias, canonical)
ON CONFLICT (category, lower(value)) DO NOTHING;

-- The merge tool learns that branch values live in alumni.branch.
CREATE OR REPLACE FUNCTION public.option_column(p_category text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_category
    WHEN 'stream'              THEN 'stream'
    WHEN 'degree'              THEN 'degree'
    WHEN 'admission_route'     THEN 'admission_route'
    WHEN 'current_status'      THEN 'current_status'
    WHEN 'field'               THEN 'field'
    WHEN 'professional_course' THEN 'professional_course'
    WHEN 'branch'              THEN 'branch'
  END
$$;


-- -----------------------------------------------------------------------------
-- 3. Import bookkeeping, then the new alumni columns
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name        text CHECK (char_length(file_name) <= 200),
  class_of         integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  rows_seen        integer NOT NULL DEFAULT 0,
  rows_created     integer NOT NULL DEFAULT 0
);

ALTER TABLE public.alumni
  ADD COLUMN IF NOT EXISTS admission_kind   text,
  ADD COLUMN IF NOT EXISTS admission_exam   text,
  ADD COLUMN IF NOT EXISTS admission_detail text,
  ADD COLUMN IF NOT EXISTS in_gap_year      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin           text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS import_batch_id  uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_key       text,
  ADD COLUMN IF NOT EXISTS invited_by       uuid REFERENCES public.alumni(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linkedin_handle  text;


-- -----------------------------------------------------------------------------
-- 4. Backfill, as the SQL editor - a trusted writer to the guard trigger
-- -----------------------------------------------------------------------------
-- The school started every row whose consent is still false.
UPDATE public.alumni SET origin = 'school' WHERE consent_given IS FALSE AND origin = 'self';

-- Before the derive trigger exists (section 12), on purpose: the stored route
-- keeps its words, and only the new columns are filled in.
UPDATE public.alumni a
   SET (admission_kind, admission_exam, admission_detail) =
       (SELECT d.kind, d.exam, d.detail FROM public.admission_from_route(a.admission_route) d)
 WHERE btrim(coalesce(a.admission_route, '')) <> '' AND a.admission_kind IS NULL;

UPDATE public.alumni
   SET linkedin_handle = public.linkedin_handle_of(linkedin_url)
 WHERE linkedin_url IS NOT NULL AND linkedin_handle IS NULL;


-- -----------------------------------------------------------------------------
-- 5. Constraints and indexes on the new columns
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE public.alumni ADD CONSTRAINT alumni_admission_kind_check
    CHECK (admission_kind IS NULL OR admission_kind IN ('board_marks','entrance_exam','management','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.alumni ADD CONSTRAINT alumni_admission_exam_matches_kind
    CHECK (CASE WHEN admission_kind = 'entrance_exam' THEN admission_exam IS NOT NULL
                ELSE admission_exam IS NULL END);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.alumni ADD CONSTRAINT alumni_admission_lengths
    CHECK (char_length(admission_exam) <= 80 AND char_length(admission_detail) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.alumni ADD CONSTRAINT alumni_origin_check CHECK (origin IN ('self','school','import'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.alumni ADD CONSTRAINT alumni_linkedin_handle_check
    CHECK (linkedin_handle IS NULL OR linkedin_handle ~ '^[a-z0-9_-]{3,100}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS alumni_import_key_unique ON public.alumni (import_key) WHERE import_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS alumni_admission_exam_idx ON public.alumni (lower(admission_exam)) WHERE admission_exam IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6. Who may see and write what - the ownership and listing rules
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so a policy can ask about `alumni` even for anon, who has no
-- SELECT on it (the trap migration 13's probe found).
CREATE OR REPLACE FUNCTION public.alumnus_is_listed(a_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM alumni
     WHERE id = a_id AND approval_status = 'approved'
       AND consent_given IS NOT FALSE AND NOT in_gap_year)
$$;
GRANT EXECUTE ON FUNCTION public.alumnus_is_listed(uuid) TO anon, authenticated;

-- The name stays - 02's policies on higher_studies and work_experience call
-- it - but it now means "publicly listed", so a hidden person's timeline is
-- hidden with them.
CREATE OR REPLACE FUNCTION public.is_approved_alumnus(a_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.alumnus_is_listed(a_id)
$$;

CREATE OR REPLACE FUNCTION public.owns_alumnus(a_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM alumni WHERE id = a_id AND user_id = auth.uid())
$$;

-- Once published, a profile's lists change only through review, the same rule
-- the guard trigger enforces for its columns.
CREATE OR REPLACE FUNCTION public.owns_unpublished_alumnus(a_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM alumni WHERE id = a_id AND user_id = auth.uid()
                  AND approval_status <> 'approved')
$$;

REVOKE ALL ON FUNCTION public.owns_alumnus(uuid), public.owns_unpublished_alumnus(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.owns_alumnus(uuid), public.owns_unpublished_alumnus(uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Every exam written
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id   uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  exam        text NOT NULL CHECK (char_length(btrim(exam)) BETWEEN 1 AND 80),
  exam_year   integer CHECK (exam_year BETWEEN 1950 AND 2100),
  exam_rank   integer CHECK (exam_rank > 0),
  percentile  numeric(6,3) CHECK (percentile BETWEEN 0 AND 100),
  gave_admit  boolean,                          -- NULL: they did not say
  got_seat    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempts_seat_is_admit CHECK (NOT got_seat OR gave_admit IS NOT FALSE)
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_once_a_year
  ON public.exam_attempts (alumni_id, lower(exam), coalesce(exam_year, 0));
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_one_seat ON public.exam_attempts (alumni_id) WHERE got_seat;
CREATE INDEX IF NOT EXISTS exam_attempts_exam_idx ON public.exam_attempts (lower(exam));
CREATE INDEX IF NOT EXISTS exam_attempts_alumni_idx ON public.exam_attempts (alumni_id);


-- -----------------------------------------------------------------------------
-- 8. Every offer not taken
-- -----------------------------------------------------------------------------
-- The seat joined stays on alumni, where every page already reads it. Storing
-- it here too is how the two would drift apart; public_seats unions them.
CREATE TABLE IF NOT EXISTS public.admits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id         uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  college_id        uuid REFERENCES public.colleges(id) ON DELETE SET NULL,
  college_name_raw  text CHECK (char_length(college_name_raw) <= 200),
  degree            text CHECK (char_length(degree) <= 60),
  branch            text CHECK (char_length(branch) <= 120),
  route_kind        text CHECK (route_kind IN ('board_marks','entrance_exam','management','other')),
  exam              text CHECK (char_length(exam) <= 80),
  route_detail      text CHECK (char_length(route_detail) <= 120),
  admit_year        integer CHECK (admit_year BETWEEN 1950 AND 2100),
  -- An offer the office recorded: the student cannot remove it, and a student
  -- list published later leaves it alone.
  added_by_school   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admits_names_a_college CHECK (college_id IS NOT NULL OR btrim(coalesce(college_name_raw, '')) <> ''),
  CONSTRAINT admits_exam_needs_kind CHECK (exam IS NULL OR route_kind = 'entrance_exam')
);
CREATE INDEX IF NOT EXISTS admits_alumni_idx ON public.admits (alumni_id);
CREATE INDEX IF NOT EXISTS admits_college_idx ON public.admits (college_id) WHERE college_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admits_once ON public.admits
  (alumni_id, coalesce(college_id::text, lower(college_name_raw)), coalesce(lower(degree), ''), coalesce(admit_year, 0));


-- -----------------------------------------------------------------------------
-- 9. Gap years
-- -----------------------------------------------------------------------------
-- A history, not one column: a student may take two, and the year must still
-- show on their timeline after they join somewhere. alumni.in_gap_year is the
-- current state, and while it is true the profile is not listed.
CREATE TABLE IF NOT EXISTS public.gap_years (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id          uuid NOT NULL REFERENCES public.alumni(id) ON DELETE CASCADE,
  gap_year           integer NOT NULL CHECK (gap_year BETWEEN 1950 AND 2100),
  kind               text NOT NULL CHECK (kind IN ('preparing','break')),
  exam               text CHECK (char_length(exam) <= 80),
  coaching_name_raw  text CHECK (char_length(coaching_name_raw) <= 120),
  coaching_org_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gap_years_prep_only CHECK (kind = 'preparing'
    OR (exam IS NULL AND coaching_name_raw IS NULL AND coaching_org_id IS NULL)),
  UNIQUE (alumni_id, gap_year)
);


-- -----------------------------------------------------------------------------
-- 10. Family and home - private, never public
-- -----------------------------------------------------------------------------
-- Nothing NOT NULL: imports and older profiles lack pieces. "Required" is the
-- form's rule, not the table's. Saved live, without review, because it is
-- never published. `source` is ready for the ERP sync.
CREATE TABLE IF NOT EXISTS public.alumni_private (
  alumni_id            uuid PRIMARY KEY REFERENCES public.alumni(id) ON DELETE CASCADE,
  guardian1_name       text CHECK (char_length(guardian1_name) <= 80),
  guardian1_relation   text CHECK (guardian1_relation IN ('Father','Mother','Guardian')),
  guardian1_phone_code text DEFAULT '+91' CHECK (char_length(guardian1_phone_code) <= 6),
  guardian1_phone      text CHECK (char_length(guardian1_phone) <= 20),
  guardian2_name       text CHECK (char_length(guardian2_name) <= 80),
  guardian2_relation   text CHECK (guardian2_relation IN ('Father','Mother','Guardian')),
  guardian2_phone_code text CHECK (char_length(guardian2_phone_code) <= 6),
  guardian2_phone      text CHECK (char_length(guardian2_phone) <= 20),
  address_line         text CHECK (char_length(address_line) <= 200),
  town                 text CHECK (char_length(town) <= 80),
  district             text CHECK (char_length(district) <= 80),
  state                text CHECK (char_length(state) <= 60),
  pin                  text CHECK (pin ~ '^[1-9][0-9]{5}$'),
  source               text NOT NULL DEFAULT 'self' CHECK (source IN ('self','school','import','erp')),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid,
  CONSTRAINT alumni_private_g2_complete CHECK (guardian2_name IS NULL OR guardian2_relation IS NOT NULL)
);

-- The school's own notes about a person. AddAlumnus used to put these in the
-- public school_note, under a label saying the opposite.
CREATE TABLE IF NOT EXISTS public.alumni_office_notes (
  alumni_id      uuid PRIMARY KEY REFERENCES public.alumni(id) ON DELETE CASCADE,
  note           text CHECK (char_length(note) <= 2000),
  login_sent_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

-- Notes written under the old "for the office" label that nobody has seen yet
-- move to the private table; ones already shown on a public page stay put.
INSERT INTO public.alumni_office_notes (alumni_id, note)
SELECT id, school_note FROM public.alumni
 WHERE origin = 'school' AND school_note IS NOT NULL AND btrim(school_note) <> ''
ON CONFLICT (alumni_id) DO NOTHING;
UPDATE public.alumni SET school_note = NULL
 WHERE origin = 'school' AND approval_status <> 'approved' AND school_note IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 11. Row security for the new tables
-- -----------------------------------------------------------------------------
-- Supabase grants every new public table to anon and authenticated by
-- default, so a GRANT here only ever adds. REVOKE first, then give back
-- exactly what is meant. Anon gets nothing: the public reads through views
-- that show bands, never ranks.
REVOKE ALL ON public.exam_attempts, public.admits, public.gap_years,
              public.alumni_private, public.alumni_office_notes, public.import_batches
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_attempts, public.admits, public.gap_years,
              public.alumni_private, public.alumni_office_notes, public.import_batches
  TO authenticated;

ALTER TABLE public.exam_attempts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gap_years           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumni_private      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumni_office_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_attempts', 'gap_years'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owner reads own" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner reads own" ON public.%I FOR SELECT TO authenticated USING (public.owns_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner adds before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner adds before publish" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.owns_unpublished_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner edits before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner edits before publish" ON public.%I FOR UPDATE TO authenticated USING (public.owns_unpublished_alumnus(alumni_id)) WITH CHECK (public.owns_unpublished_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner removes before publish" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner removes before publish" ON public.%I FOR DELETE TO authenticated USING (public.owns_unpublished_alumnus(alumni_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Admins manage" ON public.%I FOR ALL TO authenticated USING (public.is_school_admin()) WITH CHECK (public.is_school_admin())', t);
  END LOOP;
END $$;

-- Admits: the same, except an offer the school recorded is the school's.
DROP POLICY IF EXISTS "Owner reads own" ON public.admits;
CREATE POLICY "Owner reads own" ON public.admits FOR SELECT TO authenticated
  USING (public.owns_alumnus(alumni_id));
DROP POLICY IF EXISTS "Owner adds before publish" ON public.admits;
CREATE POLICY "Owner adds before publish" ON public.admits FOR INSERT TO authenticated
  WITH CHECK (public.owns_unpublished_alumnus(alumni_id) AND NOT added_by_school);
DROP POLICY IF EXISTS "Owner edits before publish" ON public.admits;
CREATE POLICY "Owner edits before publish" ON public.admits FOR UPDATE TO authenticated
  USING (public.owns_unpublished_alumnus(alumni_id) AND NOT added_by_school)
  WITH CHECK (public.owns_unpublished_alumnus(alumni_id) AND NOT added_by_school);
DROP POLICY IF EXISTS "Owner removes before publish" ON public.admits;
CREATE POLICY "Owner removes before publish" ON public.admits FOR DELETE TO authenticated
  USING (public.owns_unpublished_alumnus(alumni_id) AND NOT added_by_school);
DROP POLICY IF EXISTS "Admins manage" ON public.admits;
CREATE POLICY "Admins manage" ON public.admits FOR ALL TO authenticated
  USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());

-- Family and home: the owner reads and writes their own at any time - there is
-- no review, because none of it is ever published. Only the school deletes.
DROP POLICY IF EXISTS "Owner reads own" ON public.alumni_private;
CREATE POLICY "Owner reads own" ON public.alumni_private FOR SELECT TO authenticated
  USING (public.owns_alumnus(alumni_id) OR public.is_school_admin());
DROP POLICY IF EXISTS "Owner adds own" ON public.alumni_private;
CREATE POLICY "Owner adds own" ON public.alumni_private FOR INSERT TO authenticated
  WITH CHECK (public.owns_alumnus(alumni_id) OR public.is_school_admin());
DROP POLICY IF EXISTS "Owner edits own" ON public.alumni_private;
CREATE POLICY "Owner edits own" ON public.alumni_private FOR UPDATE TO authenticated
  USING (public.owns_alumnus(alumni_id) OR public.is_school_admin())
  WITH CHECK (public.owns_alumnus(alumni_id) OR public.is_school_admin());
DROP POLICY IF EXISTS "Admins remove" ON public.alumni_private;
CREATE POLICY "Admins remove" ON public.alumni_private FOR DELETE TO authenticated
  USING (public.is_school_admin());

-- Office notes and import batches are the school's alone.
DROP POLICY IF EXISTS "Admins only" ON public.alumni_office_notes;
CREATE POLICY "Admins only" ON public.alumni_office_notes FOR ALL TO authenticated
  USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());
DROP POLICY IF EXISTS "Admins only" ON public.import_batches;
CREATE POLICY "Admins only" ON public.import_batches FOR ALL TO authenticated
  USING (public.is_school_admin()) WITH CHECK (public.is_school_admin());


-- -----------------------------------------------------------------------------
-- 12. Triggers
-- -----------------------------------------------------------------------------

-- An exam is stored under its canonical name, whoever wrote it.
CREATE OR REPLACE FUNCTION public.canonicalise_exam()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.exam IS NOT NULL THEN
    NEW.exam := coalesce(public.exam_canonical(NEW.exam),
                         nullif(regexp_replace(btrim(NEW.exam), '\s+', ' ', 'g'), ''));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS exam_attempts_canonical_exam ON public.exam_attempts;
CREATE TRIGGER exam_attempts_canonical_exam BEFORE INSERT OR UPDATE OF exam ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.canonicalise_exam();
DROP TRIGGER IF EXISTS admits_canonical_exam ON public.admits;
CREATE TRIGGER admits_canonical_exam BEFORE INSERT OR UPDATE OF exam ON public.admits
  FOR EACH ROW EXECUTE FUNCTION public.canonicalise_exam();
DROP TRIGGER IF EXISTS gap_years_canonical_exam ON public.gap_years;
CREATE TRIGGER gap_years_canonical_exam BEFORE INSERT OR UPDATE OF exam ON public.gap_years
  FOR EACH ROW EXECUTE FUNCTION public.canonicalise_exam();

-- Links always land on a surviving institute (the shape of 10's
-- alumni_follow_merges).
CREATE OR REPLACE FUNCTION public.admits_follow_merges()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.college_id IS NOT NULL THEN
    NEW.college_id := coalesce((SELECT merged_into FROM colleges WHERE id = NEW.college_id), NEW.college_id);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS admits_follow_merges ON public.admits;
CREATE TRIGGER admits_follow_merges BEFORE INSERT OR UPDATE OF college_id ON public.admits
  FOR EACH ROW EXECUTE FUNCTION public.admits_follow_merges();

CREATE OR REPLACE FUNCTION public.gap_years_follow_merges()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.coaching_org_id IS NOT NULL THEN
    NEW.coaching_org_id := coalesce((SELECT merged_into FROM organizations WHERE id = NEW.coaching_org_id), NEW.coaching_org_id);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS gap_years_follow_merges ON public.gap_years;
CREATE TRIGGER gap_years_follow_merges BEFORE INSERT OR UPDATE OF coaching_org_id ON public.gap_years
  FOR EACH ROW EXECUTE FUNCTION public.gap_years_follow_merges();

-- Private tables: who wrote it and when, never trusted from the request.
CREATE OR REPLACE FUNCTION public.stamp_private_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF TG_TABLE_NAME = 'alumni_private'
     AND NOT (public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated')) THEN
    NEW.source := 'self';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS alumni_private_stamp ON public.alumni_private;
CREATE TRIGGER alumni_private_stamp BEFORE INSERT OR UPDATE ON public.alumni_private
  FOR EACH ROW EXECUTE FUNCTION public.stamp_private_write();
DROP TRIGGER IF EXISTS alumni_office_notes_stamp ON public.alumni_office_notes;
CREATE TRIGGER alumni_office_notes_stamp BEFORE INSERT OR UPDATE ON public.alumni_office_notes
  FOR EACH ROW EXECUTE FUNCTION public.stamp_private_write();

-- The admission fields and the LinkedIn fields, kept in step both ways. New
-- code writes the kind and the username; old clients and old staged edits
-- write admission_route and linkedin_url, and still work. Named so it sorts
-- before zz_*: the guard trigger still has the last word.
CREATE OR REPLACE FUNCTION public.alumni_derive_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d record;
  kind_changed  boolean;
  route_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    kind_changed  := NEW.admission_kind IS NOT NULL;
    route_changed := NEW.admission_kind IS NULL AND NEW.admission_route IS NOT NULL;
  ELSE
    kind_changed  := (NEW.admission_kind, NEW.admission_exam, NEW.admission_detail)
                     IS DISTINCT FROM (OLD.admission_kind, OLD.admission_exam, OLD.admission_detail);
    route_changed := NOT kind_changed AND NEW.admission_route IS DISTINCT FROM OLD.admission_route;
  END IF;

  IF route_changed THEN
    SELECT * INTO d FROM public.admission_from_route(NEW.admission_route);
    NEW.admission_kind := d.kind; NEW.admission_exam := d.exam; NEW.admission_detail := d.detail;
  END IF;

  IF NEW.admission_kind = 'entrance_exam' THEN
    NEW.admission_exam := coalesce(public.exam_canonical(NEW.admission_exam),
                                   nullif(regexp_replace(btrim(NEW.admission_exam), '\s+', ' ', 'g'), ''));
  ELSE
    NEW.admission_exam := NULL;
  END IF;
  IF NEW.admission_kind IS NULL THEN NEW.admission_detail := NULL; END IF;

  IF kind_changed THEN
    NEW.admission_route := public.admission_label(NEW.admission_kind, NEW.admission_exam, NEW.admission_detail);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.linkedin_handle IS NOT NULL THEN
      NEW.linkedin_handle := lower(btrim(NEW.linkedin_handle));
      NEW.linkedin_url    := 'https://www.linkedin.com/in/' || NEW.linkedin_handle;
    ELSE
      NEW.linkedin_handle := public.linkedin_handle_of(NEW.linkedin_url);
    END IF;
  ELSIF NEW.linkedin_handle IS DISTINCT FROM OLD.linkedin_handle THEN
    NEW.linkedin_handle := lower(btrim(NEW.linkedin_handle));
    NEW.linkedin_url    := CASE WHEN NEW.linkedin_handle IS NULL OR NEW.linkedin_handle = '' THEN NULL
                                ELSE 'https://www.linkedin.com/in/' || NEW.linkedin_handle END;
    IF NEW.linkedin_handle = '' THEN NEW.linkedin_handle := NULL; END IF;
  ELSIF NEW.linkedin_url IS DISTINCT FROM OLD.linkedin_url THEN
    NEW.linkedin_handle := public.linkedin_handle_of(NEW.linkedin_url);
  END IF;

  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS alumni_derive_fields ON public.alumni;
CREATE TRIGGER alumni_derive_fields BEFORE INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.alumni_derive_fields();

-- The guard trigger from 15, extended. Changed:
--   * the import bookkeeping columns are the school's to write;
--   * on a published profile, consent is a live switch - withdrawing it hides
--     the profile at once, and giving it publishes a profile the school has
--     already approved - and entering a gap year hides it at once, while
--     leaving one waits for review with the rest of the edit.
CREATE OR REPLACE FUNCTION public.alumni_guard_self_service()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  requested public.alumni;
BEGIN
  IF public.is_school_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    -- Trusted writers: admins, service-role API routes, the SQL editor.
    IF TG_OP = 'INSERT' AND NEW.public_slug IS NULL THEN
      NEW.public_slug := public.make_public_slug(NEW.full_name);
    END IF;

  ELSIF TG_OP = 'INSERT' THEN
    NEW.user_id             := auth.uid();
    NEW.approval_status     := 'pending';
    NEW.modification_status := 'none';
    NEW.pending_changes     := NULL;
    NEW.rejection_reason    := NULL;
    NEW.school_note         := NULL;
    NEW.review_note         := NULL;
    NEW.review_note_at      := NULL;
    NEW.public_slug         := public.make_public_slug(NEW.full_name);
    NEW.origin              := 'self';
    NEW.import_batch_id     := NULL;
    NEW.import_key          := NULL;

  ELSE
    -- Only the school decides these, whatever the row's state.
    NEW.id               := OLD.id;
    NEW.user_id          := OLD.user_id;
    NEW.approval_status  := OLD.approval_status;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.school_note      := OLD.school_note;
    NEW.review_note      := OLD.review_note;
    NEW.review_note_at   := OLD.review_note_at;
    NEW.public_slug      := OLD.public_slug;
    NEW.origin           := OLD.origin;
    NEW.import_batch_id  := OLD.import_batch_id;
    NEW.import_key       := OLD.import_key;
    NEW.invited_by       := OLD.invited_by;

    -- A published profile changes only through review. Its owner may stage
    -- edits, confirm the profile, keep their private contact details current,
    -- and switch consent. Starting from OLD protects any column added later
    -- by default. Copied field by field: jsonb_populate_record(OLD, ...) reads
    -- a column added later with a default as NULL on older rows (see 07).
    IF OLD.approval_status = 'approved' THEN
      requested := NEW;
      NEW := OLD;
      NEW.pending_changes     := requested.pending_changes;
      NEW.modification_status := CASE WHEN requested.modification_status = 'pending'
                                      THEN 'pending' ELSE OLD.modification_status END;
      NEW.last_confirmed_at   := requested.last_confirmed_at;
      NEW.personal_email      := requested.personal_email;
      NEW.phone_country_code  := requested.phone_country_code;
      NEW.phone_number        := requested.phone_number;
      NEW.consent_given       := coalesce(requested.consent_given, OLD.consent_given);
      NEW.in_gap_year         := OLD.in_gap_year OR coalesce(requested.in_gap_year, false);
    END IF;

    -- The clock starts when an edit enters the queue, and only then.
    IF NEW.modification_status = 'pending'
       AND OLD.modification_status IS DISTINCT FROM 'pending' THEN
      NEW.edits_staged_at := now();
    ELSIF NEW.modification_status IS DISTINCT FROM 'pending' THEN
      NEW.edits_staged_at := NULL;
    END IF;
  END IF;

  -- Always derived, never trusted from the request.
  NEW.email_key := public.email_key(NEW.personal_email);
  NEW.phone_key := public.phone_key(NEW.phone_country_code, NEW.phone_number);
  RETURN NEW;
END
$$;

-- Nobody is published before they agree. Runs last (zzz), so it sees the row
-- as every other trigger has left it.
CREATE OR REPLACE FUNCTION public.alumni_guard_consent()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.approval_status = 'approved' AND NEW.consent_given IS FALSE
     AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved') THEN
    RAISE EXCEPTION 'This profile cannot be published until its owner has agreed to appear.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS zzz_alumni_guard_consent ON public.alumni;
CREATE TRIGGER zzz_alumni_guard_consent BEFORE INSERT OR UPDATE ON public.alumni
  FOR EACH ROW EXECUTE FUNCTION public.alumni_guard_consent();


-- -----------------------------------------------------------------------------
-- 13. The seat attempt every entrance-exam profile already implies
-- -----------------------------------------------------------------------------
INSERT INTO public.exam_attempts (alumni_id, exam, exam_year, exam_rank, gave_admit, got_seat)
SELECT a.id, a.admission_exam,
       CASE WHEN a.class_of BETWEEN 1950 AND 2100 THEN a.class_of END,
       CASE WHEN regexp_replace(coalesce(a.admission_rank::text, ''), '\D', '', 'g') ~ '^[0-9]{1,9}$'
            THEN nullif(regexp_replace(a.admission_rank::text, '\D', '', 'g')::int, 0) END,
       true, true
  FROM public.alumni a
 WHERE a.admission_kind = 'entrance_exam' AND a.admission_exam IS NOT NULL
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- 14. Views - the public side, one listing rule throughout
-- -----------------------------------------------------------------------------
-- public_alumni: 17's columns unchanged, four added at the end, and the WHERE
-- becomes the listing rule. CREATE OR REPLACE, so there is no window without
-- the view and the grant survives. Exact ranks and marks are still here;
-- migration 20 bands them.
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

-- Exams written, by listed people only, with a band where the rank was.
CREATE OR REPLACE VIEW public.public_exam_attempts AS
SELECT e.id, e.alumni_id, e.exam, e.exam_year, e.gave_admit, e.got_seat,
       public.rank_band_edge(e.exam_rank)        AS rank_band_edge,
       public.percentile_band_floor(e.percentile) AS percentile_band_floor
  FROM public.exam_attempts e
  JOIN public.alumni a ON a.id = e.alumni_id
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;

-- Offers not taken, by listed people, with enough of the college to show it.
CREATE OR REPLACE VIEW public.public_admits AS
SELECT ad.id, ad.alumni_id, ad.college_id, ad.college_name_raw, ad.degree, ad.branch,
       ad.route_kind, ad.exam, ad.route_detail, ad.admit_year,
       CASE WHEN c.id IS NULL THEN NULL ELSE
         jsonb_build_object(
           'name', c.name, 'state', c.state, 'district', c.district, 'logo_url', c.logo_url,
           'aliases', coalesce((SELECT jsonb_agg(ia.alias ORDER BY ia.alias)
                                  FROM institute_aliases ia WHERE ia.college_id = c.id), '[]'::jsonb))
       END AS college
  FROM public.admits ad
  JOIN public.alumni a ON a.id = ad.alumni_id
  LEFT JOIN public.colleges c ON c.id = ad.college_id
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;

-- Gap years of listed people - which, by the listing rule, means years they
-- have already moved past.
CREATE OR REPLACE VIEW public.public_gap_years AS
SELECT g.id, g.alumni_id, g.gap_year, g.kind, g.exam, g.coaching_name_raw,
       o.name AS coaching_org_name
  FROM public.gap_years g
  JOIN public.alumni a ON a.id = g.alumni_id
  LEFT JOIN public.organizations o ON o.id = g.coaching_org_id
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;

-- Every seat a listed person was offered: the one joined, and the rest.
CREATE OR REPLACE VIEW public.public_seats AS
SELECT a.id AS alumni_id, a.college_id, a.college_name_raw, a.degree, a.branch,
       a.admission_kind AS route_kind, a.admission_exam AS exam, true AS joined
  FROM public.alumni a
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year
   AND (a.college_id IS NOT NULL OR btrim(coalesce(a.college_name_raw, '')) <> '')
UNION ALL
SELECT ad.alumni_id, ad.college_id, ad.college_name_raw, ad.degree, ad.branch,
       ad.route_kind, ad.exam, false
  FROM public.admits ad
  JOIN public.alumni a ON a.id = ad.alumni_id
 WHERE a.approval_status = 'approved' AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year;

-- A photo credit names only someone who is listed.
CREATE OR REPLACE VIEW public.college_photos_public AS
SELECT
  p.id,
  p.college_id,
  p.url,
  p.caption,
  p.created_at,
  a.full_name   AS shared_by,
  a.public_slug AS shared_by_slug,
  a.class_of    AS shared_by_class
FROM public.college_photos p
LEFT JOIN public.alumni a
  ON a.id = p.alumni_id AND a.approval_status = 'approved'
 AND a.consent_given IS NOT FALSE AND NOT a.in_gap_year
WHERE p.status = 'approved';

-- Views too are granted to everyone by default; narrow them to reading.
REVOKE ALL ON public.public_exam_attempts, public.public_admits, public.public_gap_years,
              public.public_seats FROM anon, authenticated;
GRANT SELECT ON public.public_exam_attempts, public.public_admits, public.public_gap_years,
               public.public_seats, public.college_photos_public TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 15. merge_institute learns about offers and coaching centres
-- -----------------------------------------------------------------------------
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

  RETURN jsonb_build_object('into', target, 'moved_alumni', moved_alumni, 'moved_staged_edits', moved_staged);
END
$$;

REVOKE ALL ON FUNCTION public.merge_institute(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_institute(text, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK, in one transaction:
--   restore migration 15's alumni_guard_self_service body FIRST (it names the
--   columns below), 17's public_alumni, merge_institute and 13's
--   college_photos_public; then
--   DROP VIEW public_seats, public_gap_years, public_admits, public_exam_attempts;
--   DROP TRIGGER zzz_alumni_guard_consent, alumni_derive_fields ON alumni;
--   DROP TABLE alumni_office_notes, alumni_private, gap_years, admits, exam_attempts;
--   ALTER TABLE alumni DROP COLUMN admission_kind, admission_exam, admission_detail,
--     in_gap_year, origin, import_batch_id, import_key, invited_by, linkedin_handle;
--   DROP TABLE import_batches;
--   restore 02's is_approved_alumnus; restore 14's option_column.
-- Rows moved from school_note to alumni_office_notes must be copied back first.
-- =============================================================================
