-- =============================================================================
-- Veveaham Alumni — Migration 11: merge verified duplicates, seed aliases
-- =============================================================================
-- REQUIRES migrations 09 and 10. Safe to re-run: merges skip what is already
-- merged, inserts skip names that already exist, aliases skip duplicates.
--
-- Everything here was checked against the live colleges table on 2026-09-17.
-- Two findings shaped it:
--   - The AISHE import left out most national institutes: IIT Bombay, the
--     NITs, most IISERs, AIIMS, JIPMER and SRM had no row at all, so a student
--     typing "NIT Trichy" found nothing. Those are inserted.
--   - Some names exist several times under different institute codes (Madras
--     Medical College, CMC Vellore), or under the wrong campus (the BITS
--     "Pilani" row is in Goa). Those are NOT guessed at here: they are left for
--     an admin to merge from the dashboard.
--
-- One transaction. NOTICE lines report anything skipped.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Merge the three verified duplicate groups
-- -----------------------------------------------------------------------------
-- Only rows that share a name key AND the same state, district, university and
-- year - i.e. genuinely the same institute entered twice. The survivor is the
-- one our alumni are linked to, then the one with a banner, then the one with
-- proper capitals ("IISER" over "Iiser").
DO $$
DECLARE
  g record;
  survivor uuid;
  dup uuid;
BEGIN
  FOR g IN
    SELECT name_key,
           concat_ws('|', state, district, university_name, established_year::text) AS place,
           array_agg(id) AS ids
      FROM public.colleges
     WHERE merged_into IS NULL
       AND name_key IN ('iiserthiruvananthapuram', 'velloreinstituteoftechnologyvellore', 'sastradeemeduniversitythanjavur')
     GROUP BY 1, 2
    HAVING count(*) > 1
  LOOP
    SELECT c.id INTO survivor
      FROM public.colleges c
     WHERE c.id = ANY (g.ids)
     ORDER BY (SELECT count(*) FROM public.alumni a WHERE a.college_id = c.id) DESC,
              (c.banner_url IS NOT NULL) DESC,
              (c.name ~ '[A-Z]{2,}') DESC,
              c.id
     LIMIT 1;
    FOREACH dup IN ARRAY g.ids LOOP
      IF dup <> survivor THEN
        PERFORM public.merge_institute('college', dup, survivor);
      END IF;
    END LOOP;
    RAISE NOTICE 'merged % duplicate(s) of % into %', cardinality(g.ids) - 1, g.name_key, survivor;
  END LOOP;
END
$$;


-- -----------------------------------------------------------------------------
-- 2. Tidy two admin-added names
-- -----------------------------------------------------------------------------
DO $$
DECLARE target uuid;
BEGIN
  SELECT (array_agg(id))[1] INTO target FROM public.colleges
   WHERE merged_into IS NULL AND name_key = 'christuniversity' HAVING count(*) = 1;
  IF target IS NOT NULL THEN
    PERFORM public.admin_rename_institute('college', target, 'Christ University');
  END IF;
END
$$;


-- -----------------------------------------------------------------------------
-- 3. The seed
-- -----------------------------------------------------------------------------
-- match_name set   -> attach to that existing row (exactly one match, else skip)
-- match_name NULL  -> reuse a row already called insert_name (or aliased so),
--                     otherwise insert it
-- state/district only ever fill an empty location; they never overwrite one.
DROP TABLE IF EXISTS pg_temp.college_seed;
CREATE TEMP TABLE college_seed (
  match_name  text,
  insert_name text,
  state       text,
  district    text,
  aliases     text[]
);

INSERT INTO college_seed (match_name, insert_name, state, district, aliases) VALUES
-- ── Already in the table: aliases (and a missing location) ──
('IIT Madras', NULL, 'Tamil Nadu', 'Chennai', ARRAY['Indian Institute of Technology Madras', 'IITM', 'IIT Chennai']),
('IISER Thiruvananthapuram', NULL, 'Kerala', 'Thiruvananthapuram', ARRAY['IISER TVM', 'IISER Trivandrum', 'Indian Institute of Science Education and Research Thiruvananthapuram']),
('NATIONAL INSTITUTE OF SCIENCE EDUCATION AND RESEARCH', NULL, 'Odisha', 'Khordha', ARRAY['NISER', 'NISER Bhubaneswar']),
('Anna University', NULL, 'Tamil Nadu', 'Chennai', ARRAY['Anna University Chennai']),
('College of Engineering, Guindy Campus', NULL, NULL, NULL, ARRAY['CEG', 'College of Engineering Guindy', 'Anna University CEG', 'Guindy Engineering College']),
('Madras Institute of Technology Campus', NULL, NULL, NULL, ARRAY['MIT Chennai', 'MIT Chromepet', 'Madras Institute of Technology', 'Anna University MIT']),
('Alagappa College of Technology Campus', NULL, NULL, NULL, ARRAY['ACT Chennai', 'Alagappa College of Technology']),
('PSG College of Technology', NULL, NULL, NULL, ARRAY['PSG Tech', 'PSGCT', 'PSG College of Tech']),
('Coimbatore Institute of Technology', NULL, NULL, NULL, ARRAY['CIT Coimbatore']),
('Government College of Technology', NULL, NULL, NULL, ARRAY['GCT', 'GCT Coimbatore', 'Government College of Technology Coimbatore']),
('Thiagarajar College of Engineering, Madurai', NULL, NULL, NULL, ARRAY['TCE', 'TCE Madurai', 'Thiagarajar College of Engineering']),
('Sri Sivasubramaniya Nadar College of Engineering', NULL, NULL, NULL, ARRAY['SSN', 'SSN College of Engineering', 'SSNCE', 'SSN Chennai']),
('Kumaraguru college of Technology', NULL, NULL, NULL, ARRAY['KCT', 'KCT Coimbatore']),
('Kongu Engineering College', NULL, NULL, NULL, ARRAY['KEC Perundurai', 'Kongu Engineering College Perundurai']),
('Bannari Amman Institute of Technology', NULL, NULL, NULL, ARRAY['BIT Sathy', 'BIT Sathyamangalam', 'BAIT']),
('Amrita Vishwa Vidyapeetham Coimbatore', NULL, 'Tamil Nadu', 'Coimbatore', ARRAY['Amrita Coimbatore', 'Amrita University Coimbatore', 'Amrita School of Engineering Coimbatore']),
('SASTRA Deemed University, Thanjavur', NULL, 'Tamil Nadu', 'Thanjavur', ARRAY['SASTRA Thanjavur', 'Shanmugha Arts Science Technology and Research Academy']),
('Vellore Institute of Technology, Vellore', NULL, 'Tamil Nadu', 'Vellore', ARRAY['VIT University']),
('LOYOLA COLLEGE', NULL, NULL, 'Chennai', ARRAY['Loyola College Chennai', 'Loyola Chennai']),
('MADRAS CHRISTIAN COLLEGE', NULL, NULL, NULL, ARRAY['MCC', 'MCC Chennai', 'MCC Tambaram']),
('St. Joseph''s College Trichy', NULL, 'Tamil Nadu', 'Tiruchirappalli', ARRAY['St. Joseph''s College Tiruchirappalli', 'SJC Trichy', 'SJC Tiruchirappalli']),
('Bishop Heber College, Tiruchirappalli - 620 017.', NULL, NULL, NULL, ARRAY['Bishop Heber College', 'BHC Trichy']),
('PSG College of Arts and Science', NULL, NULL, NULL, ARRAY['PSG CAS', 'PSGCAS', 'PSG Arts']),
('STELLA MARIS COLLEGE [AUTONOMOUS]', NULL, NULL, NULL, ARRAY['Stella Maris College Chennai', 'Stella Maris']),
('WOMENS CHRISTIAN COLLEGE', NULL, NULL, 'Chennai', ARRAY['Women''s Christian College Chennai', 'WCC Chennai']),
('ETHIRAJ COLLEGE FOR WOMEN', NULL, NULL, NULL, ARRAY['Ethiraj College', 'Ethiraj']),
('LADY DOAK COLLEGE', NULL, NULL, NULL, ARRAY['LDC Madurai', 'Lady Doak']),
('Christ University', NULL, 'Karnataka', 'Bengaluru Urban', ARRAY['Christ University Bangalore', 'Christ (Deemed to be University)']),
('NATIONAL INSTITUTE OF FASHION TECHNOLOGY, CHENNAI', NULL, NULL, NULL, ARRAY['NIFT Chennai']),
('STANLEY MEDICAL COLLEGE & HOSPITAL (Inst. Code - 002), CHENNAI', NULL, NULL, NULL, ARRAY['Stanley Medical College', 'SMC Chennai']),
('GOVERNMENT KILPAUK MEDICAL COLLEGE (Inst. Code - 004), CHENNAI', NULL, NULL, NULL, ARRAY['Kilpauk Medical College', 'KMC Chennai']),
('COIMBATORE MEDICAL COLLEGE (Inst. Code - 007), COIMBATORE', NULL, NULL, NULL, ARRAY['Coimbatore Medical College', 'CMC Coimbatore']),
('PSG INSTITUTE OF MEDICAL SCIENCES AND RESEARCH (Inst. Code - 446), COIMBATORE', NULL, NULL, NULL, ARRAY['PSG IMSR', 'PSG Medical College', 'PSG Institute of Medical Sciences']),
('MADURAI MEDICAL COLLEGE & HOSPITAL (Inst. Code - 003), MADURAI', NULL, NULL, NULL, ARRAY['Madurai Medical College', 'MMC Madurai']),
-- ── Missing from the table: inserted ──
(NULL, 'IIT Bombay', 'Maharashtra', 'Mumbai Suburban', ARRAY['Indian Institute of Technology Bombay', 'IITB', 'IIT Mumbai']),
(NULL, 'IIT Delhi', 'Delhi', 'New Delhi', ARRAY['Indian Institute of Technology Delhi', 'IITD']),
(NULL, 'IIT Kharagpur', 'West Bengal', 'Paschim Medinipur', ARRAY['Indian Institute of Technology Kharagpur', 'IIT KGP']),
(NULL, 'IIT Hyderabad', 'Telangana', 'Sangareddy', ARRAY['Indian Institute of Technology Hyderabad', 'IITH']),
(NULL, 'IIT Tirupati', 'Andhra Pradesh', 'Tirupati', ARRAY['Indian Institute of Technology Tirupati']),
(NULL, 'IIT Palakkad', 'Kerala', 'Palakkad', ARRAY['Indian Institute of Technology Palakkad']),
(NULL, 'NIT Tiruchirappalli', 'Tamil Nadu', 'Tiruchirappalli', ARRAY['National Institute of Technology Tiruchirappalli', 'NIT Trichy', 'NITT', 'REC Trichy']),
(NULL, 'NIT Karnataka, Surathkal', 'Karnataka', 'Dakshina Kannada', ARRAY['National Institute of Technology Karnataka', 'NITK', 'NIT Surathkal']),
(NULL, 'NIT Calicut', 'Kerala', 'Kozhikode', ARRAY['National Institute of Technology Calicut', 'NITC']),
(NULL, 'NIT Warangal', 'Telangana', 'Hanamkonda', ARRAY['National Institute of Technology Warangal', 'NITW']),
(NULL, 'NIT Puducherry', 'Puducherry', 'Karaikal', ARRAY['National Institute of Technology Puducherry', 'NIT Karaikal']),
(NULL, 'IIITDM Kancheepuram', 'Tamil Nadu', 'Chennai', ARRAY['Indian Institute of Information Technology Design and Manufacturing Kancheepuram', 'IIIT Kancheepuram']),
(NULL, 'IISER Pune', 'Maharashtra', 'Pune', ARRAY['Indian Institute of Science Education and Research Pune']),
(NULL, 'IISER Kolkata', 'West Bengal', 'Nadia', ARRAY['Indian Institute of Science Education and Research Kolkata']),
(NULL, 'IISER Mohali', 'Punjab', 'Sahibzada Ajit Singh Nagar', ARRAY['Indian Institute of Science Education and Research Mohali']),
(NULL, 'IISER Bhopal', 'Madhya Pradesh', 'Bhopal', ARRAY['Indian Institute of Science Education and Research Bhopal']),
(NULL, 'IISER Tirupati', 'Andhra Pradesh', 'Tirupati', ARRAY['Indian Institute of Science Education and Research Tirupati']),
(NULL, 'IISER Berhampur', 'Odisha', 'Ganjam', ARRAY['Indian Institute of Science Education and Research Berhampur']),
(NULL, 'IISc Bangalore', 'Karnataka', 'Bengaluru Urban', ARRAY['Indian Institute of Science', 'IISc', 'Indian Institute of Science Bangalore', 'IISc Bengaluru']),
(NULL, 'AIIMS New Delhi', 'Delhi', 'New Delhi', ARRAY['All India Institute of Medical Sciences New Delhi', 'AIIMS Delhi', 'AIIMS']),
(NULL, 'AIIMS Madurai', 'Tamil Nadu', 'Madurai', ARRAY['All India Institute of Medical Sciences Madurai']),
(NULL, 'JIPMER Puducherry', 'Puducherry', 'Puducherry', ARRAY['Jawaharlal Institute of Postgraduate Medical Education and Research', 'JIPMER']),
(NULL, 'SRM Institute of Science and Technology', 'Tamil Nadu', 'Chengalpattu', ARRAY['SRM', 'SRMIST', 'SRM University', 'SRM Kattankulathur']),
(NULL, 'Karunya Institute of Technology and Sciences', 'Tamil Nadu', 'Coimbatore', ARRAY['Karunya', 'Karunya University']),
(NULL, 'Presidency College, Chennai', 'Tamil Nadu', 'Chennai', ARRAY['Presidency College']),
(NULL, 'Tamil Nadu Agricultural University', 'Tamil Nadu', 'Coimbatore', ARRAY['TNAU', 'TNAU Coimbatore']),
(NULL, 'University of Madras', 'Tamil Nadu', 'Chennai', ARRAY['Madras University']),
(NULL, 'Bharathiar University', 'Tamil Nadu', 'Coimbatore', ARRAY[]::text[]),
(NULL, 'Madurai Kamaraj University', 'Tamil Nadu', 'Madurai', ARRAY['MKU']),
(NULL, 'Pondicherry University', 'Puducherry', 'Puducherry', ARRAY['Puducherry University']),
(NULL, 'Central University of Tamil Nadu', 'Tamil Nadu', 'Tiruvarur', ARRAY['CUTN']),
(NULL, 'National Law School of India University', 'Karnataka', 'Bengaluru Urban', ARRAY['NLSIU', 'NLS Bangalore']),
(NULL, 'IIM Tiruchirappalli', 'Tamil Nadu', 'Tiruchirappalli', ARRAY['Indian Institute of Management Tiruchirappalli', 'IIM Trichy']);

DO $$
DECLARE
  r record;
  ids uuid[];
  target uuid;
  target_key text;
  a text;
  inserted int := 0;
  attached int := 0;
  aliases_added int := 0;
  n int;
BEGIN
  FOR r IN SELECT * FROM college_seed LOOP
    IF r.match_name IS NOT NULL THEN
      SELECT array_agg(id) INTO ids FROM public.colleges
       WHERE merged_into IS NULL AND name_key = public.inst_key(r.match_name);
    ELSE
      SELECT array_agg(DISTINCT x.id) INTO ids FROM (
        SELECT id FROM public.colleges
         WHERE merged_into IS NULL AND name_key = public.inst_key(r.insert_name)
        UNION
        SELECT a2.college_id FROM public.institute_aliases a2
          JOIN public.colleges c ON c.id = a2.college_id
         WHERE c.merged_into IS NULL AND a2.alias_key = public.inst_key(r.insert_name)
      ) x;
    END IF;

    IF coalesce(cardinality(ids), 0) = 0 THEN
      IF r.match_name IS NOT NULL THEN
        RAISE NOTICE 'seed: "%" not found - skipped', r.match_name;
        CONTINUE;
      END IF;
      INSERT INTO public.colleges (name, state, district, added_by_admin, status)
      VALUES (r.insert_name, r.state, r.district, true, 'approved')
      RETURNING id INTO target;
      inserted := inserted + 1;
    ELSIF cardinality(ids) = 1 THEN
      target := ids[1];
      UPDATE public.colleges
         SET state = coalesce(state, r.state), district = coalesce(district, r.district)
       WHERE id = target;
      attached := attached + 1;
    ELSE
      RAISE NOTICE 'seed: "%" matches % rows - skipped for an admin to merge',
        coalesce(r.match_name, r.insert_name), cardinality(ids);
      CONTINUE;
    END IF;

    SELECT name_key INTO target_key FROM public.colleges WHERE id = target;
    FOREACH a IN ARRAY r.aliases LOOP
      IF char_length(public.inst_key(a)) >= 2 AND public.inst_key(a) <> target_key THEN
        INSERT INTO public.institute_aliases (college_id, alias, source)
        VALUES (target, a, 'seed')
        ON CONFLICT (entity_id, alias_key) DO NOTHING;
        GET DIAGNOSTICS n = ROW_COUNT;
        aliases_added := aliases_added + n;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'seed done: % inserted, % existing rows given aliases, % aliases added', inserted, attached, aliases_added;
END
$$;

DROP TABLE IF EXISTS pg_temp.college_seed;

-- =============================================================================
-- LEFT FOR AN ADMIN (Admin -> Institutes -> Merge into...), because the right
-- survivor is a judgement call:
--   - "St. Joseph's College, Tiruchirappalli - 620 002." into "St. Joseph's College Trichy"
--   - "VELLORE INSTITUTE OF TECHNOLOGY, CHENNAI" and "vit chennai"
--   - Madras Medical College (codes 001 and 395), CMC Vellore (011/436/515)
-- ROLLBACK: DELETE FROM institute_aliases WHERE source = 'seed'; delete the
-- inserted rows (added_by_admin, names above, no alumni linked). Merges are
-- one-way; the merged rows still exist with merged_into set.
-- =============================================================================
