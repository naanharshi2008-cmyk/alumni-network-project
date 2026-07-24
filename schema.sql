-- SQL Migrations for Veveaham Alumni Network
-- Run these commands in your Supabase SQL Editor to update your database schema.

-- ==============================================================================
-- 1. Update colleges table with geographic, website, and engineering details
-- ==============================================================================
ALTER TABLE colleges 
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS university_name TEXT,
ADD COLUMN IF NOT EXISTS management_type TEXT,
ADD COLUMN IF NOT EXISTS established_year INTEGER,
ADD COLUMN IF NOT EXISTS is_engineering BOOLEAN DEFAULT false;

-- Create indexes for faster filtering
CREATE INDEX IF NOT EXISTS idx_colleges_state ON colleges(state);
CREATE INDEX IF NOT EXISTS idx_colleges_is_engineering ON colleges(is_engineering);

-- ==============================================================================
-- 2. Update alumni table with auth, modifications, and school selection details
-- ==============================================================================
ALTER TABLE alumni
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS school_name TEXT DEFAULT 'Veveaham Hr. Sec. School',
ADD COLUMN IF NOT EXISTS modification_status TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS original_data JSONB;

-- Create indexes for fast profile lookups
CREATE INDEX IF NOT EXISTS idx_alumni_user_id ON alumni(user_id);
CREATE INDEX IF NOT EXISTS idx_alumni_username ON alumni(username);
CREATE INDEX IF NOT EXISTS idx_alumni_class_of ON alumni(class_of);

-- ==============================================================================
-- 3. Update Row Level Security (RLS) policies for alumni
-- ==============================================================================

-- Enable RLS on alumni if not already enabled
ALTER TABLE alumni ENABLE ROW LEVEL SECURITY;

-- Allow alumni to read their own profile (even if pending)
DROP POLICY IF EXISTS "Alumni can view own profile" ON alumni;
CREATE POLICY "Alumni can view own profile" 
ON alumni FOR SELECT 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email());

-- Allow alumni to update their own profile
DROP POLICY IF EXISTS "Alumni can update own profile" ON alumni;
CREATE POLICY "Alumni can update own profile" 
ON alumni FOR UPDATE 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email())
WITH CHECK (user_id = auth.uid() OR personal_email = auth.email());

-- Ensure admins (staff) can do everything
-- Note: Replace with proper check if you have a custom admin role/email claim
DROP POLICY IF EXISTS "Admins have full access" ON alumni;
CREATE POLICY "Admins have full access"
ON alumni FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- ==============================================================================
-- 4. New table: higher_studies (added 2026-07-21)
-- One alumni row can have MANY higher-studies entries (PG, PhD, diploma, etc),
-- each with its own finishing year -- this is why it's a separate table
-- instead of extra columns on "alumni".
-- ==============================================================================

CREATE TABLE IF NOT EXISTS higher_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which alumnus this entry belongs to. If the alumni row is ever deleted,
  -- their higher-studies rows are deleted automatically (ON DELETE CASCADE).
  alumni_id UUID NOT NULL REFERENCES alumni(id) ON DELETE CASCADE,
  degree_name TEXT NOT NULL,        -- e.g. "MS", "MBA", "PhD"
  institution TEXT,                 -- e.g. "Stanford University" (optional)
  start_year INTEGER,               -- optional
  finish_year INTEGER,              -- the field the senior asked for
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Speeds up "get all higher-studies entries for this alumnus" lookups
CREATE INDEX IF NOT EXISTS idx_higher_studies_alumni_id ON higher_studies(alumni_id);

-- Turn on row-level security so people can only touch their own rows
ALTER TABLE higher_studies ENABLE ROW LEVEL SECURITY;

-- Anyone can READ higher-studies entries (same as the directory being public)
DROP POLICY IF EXISTS "Higher studies are publicly viewable" ON higher_studies;
CREATE POLICY "Higher studies are publicly viewable"
ON higher_studies FOR SELECT
TO anon, authenticated
USING (true);

-- A logged-in alumnus can add/edit/delete ONLY their own higher-studies rows
DROP POLICY IF EXISTS "Alumni manage own higher studies" ON higher_studies;
CREATE POLICY "Alumni manage own higher studies"
ON higher_studies FOR ALL
TO authenticated
USING (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
)
WITH CHECK (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
);

-- Admins can do everything, same pattern as the alumni table above
DROP POLICY IF EXISTS "Admins have full access to higher studies" ON higher_studies;
CREATE POLICY "Admins have full access to higher studies"
ON higher_studies FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- ==============================================================================
-- 5. New table: work_experience (added 2026-07-21)
-- Same idea as higher_studies -- one alumnus can have MANY jobs over time
-- (like a LinkedIn "Experience" section), each with its own start/end year.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS work_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id UUID NOT NULL REFERENCES alumni(id) ON DELETE CASCADE,
  company TEXT NOT NULL,             -- e.g. "Google"
  role TEXT,                         -- e.g. "Software Engineer" (optional)
  start_year INTEGER,
  end_year INTEGER,                  -- leave blank if this is their current job
  is_current BOOLEAN DEFAULT false,  -- true = "Present", like on LinkedIn
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_experience_alumni_id ON work_experience(alumni_id);

ALTER TABLE work_experience ENABLE ROW LEVEL SECURITY;

-- Anyone can read work experience entries (same as the public directory)
DROP POLICY IF EXISTS "Work experience is publicly viewable" ON work_experience;
CREATE POLICY "Work experience is publicly viewable"
ON work_experience FOR SELECT
TO anon, authenticated
USING (true);

-- A logged-in alumnus can add/edit/delete ONLY their own entries
DROP POLICY IF EXISTS "Alumni manage own work experience" ON work_experience;
CREATE POLICY "Alumni manage own work experience"
ON work_experience FOR ALL
TO authenticated
USING (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
)
WITH CHECK (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins have full access to work experience" ON work_experience;
CREATE POLICY "Admins have full access to work experience"
ON work_experience FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');
-- SQL Migrations for Veveaham Alumni Network
-- Run these commands in your Supabase SQL Editor to update your database schema.

-- ==============================================================================
-- 1. Update colleges table with geographic, website, and engineering details
-- ==============================================================================
ALTER TABLE colleges 
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS university_name TEXT,
ADD COLUMN IF NOT EXISTS management_type TEXT,
ADD COLUMN IF NOT EXISTS established_year INTEGER,
ADD COLUMN IF NOT EXISTS is_engineering BOOLEAN DEFAULT false;

-- Create indexes for faster filtering
CREATE INDEX IF NOT EXISTS idx_colleges_state ON colleges(state);
CREATE INDEX IF NOT EXISTS idx_colleges_is_engineering ON colleges(is_engineering);

-- ==============================================================================
-- 2. Update alumni table with auth, modifications, and school selection details
-- ==============================================================================
ALTER TABLE alumni
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS school_name TEXT DEFAULT 'Veveaham Hr. Sec. School',
ADD COLUMN IF NOT EXISTS modification_status TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS original_data JSONB;

-- Create indexes for fast profile lookups
CREATE INDEX IF NOT EXISTS idx_alumni_user_id ON alumni(user_id);
CREATE INDEX IF NOT EXISTS idx_alumni_username ON alumni(username);
CREATE INDEX IF NOT EXISTS idx_alumni_class_of ON alumni(class_of);

-- ==============================================================================
-- 3. Update Row Level Security (RLS) policies for alumni
-- ==============================================================================

-- Enable RLS on alumni if not already enabled
ALTER TABLE alumni ENABLE ROW LEVEL SECURITY;

-- Allow alumni to read their own profile (even if pending)
DROP POLICY IF EXISTS "Alumni can view own profile" ON alumni;
CREATE POLICY "Alumni can view own profile" 
ON alumni FOR SELECT 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email());

-- Allow alumni to update their own profile
DROP POLICY IF EXISTS "Alumni can update own profile" ON alumni;
CREATE POLICY "Alumni can update own profile" 
ON alumni FOR UPDATE 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email())
WITH CHECK (user_id = auth.uid() OR personal_email = auth.email());

-- Ensure admins (staff) can do everything
-- Note: Replace with proper check if you have a custom admin role/email claim
DROP POLICY IF EXISTS "Admins have full access" ON alumni;
CREATE POLICY "Admins have full access"
ON alumni FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- ==============================================================================
-- 4. New table: higher_studies (added 2026-07-21)
-- One alumni row can have MANY higher-studies entries (PG, PhD, diploma, etc),
-- each with its own finishing year -- this is why it's a separate table
-- instead of extra columns on "alumni".
-- ==============================================================================

CREATE TABLE IF NOT EXISTS higher_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which alumnus this entry belongs to. If the alumni row is ever deleted,
  -- their higher-studies rows are deleted automatically (ON DELETE CASCADE).
  alumni_id UUID NOT NULL REFERENCES alumni(id) ON DELETE CASCADE,
  degree_name TEXT NOT NULL,        -- e.g. "MS", "MBA", "PhD"
  institution TEXT,                 -- e.g. "Stanford University" (optional)
  start_year INTEGER,               -- optional
  finish_year INTEGER,              -- the field the senior asked for
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Speeds up "get all higher-studies entries for this alumnus" lookups
CREATE INDEX IF NOT EXISTS idx_higher_studies_alumni_id ON higher_studies(alumni_id);

-- Turn on row-level security so people can only touch their own rows
ALTER TABLE higher_studies ENABLE ROW LEVEL SECURITY;

-- Anyone can READ higher-studies entries (same as the directory being public)
DROP POLICY IF EXISTS "Higher studies are publicly viewable" ON higher_studies;
CREATE POLICY "Higher studies are publicly viewable"
ON higher_studies FOR SELECT
TO anon, authenticated
USING (true);

-- A logged-in alumnus can add/edit/delete ONLY their own higher-studies rows
DROP POLICY IF EXISTS "Alumni manage own higher studies" ON higher_studies;
CREATE POLICY "Alumni manage own higher studies"
ON higher_studies FOR ALL
TO authenticated
USING (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
)
WITH CHECK (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
);

-- Admins can do everything, same pattern as the alumni table above
DROP POLICY IF EXISTS "Admins have full access to higher studies" ON higher_studies;
CREATE POLICY "Admins have full access to higher studies"
ON higher_studies FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- ==============================================================================
-- 5. New table: work_experience (added 2026-07-21)
-- Same idea as higher_studies -- one alumnus can have MANY jobs over time
-- (like a LinkedIn "Experience" section), each with its own start/end year.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS work_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alumni_id UUID NOT NULL REFERENCES alumni(id) ON DELETE CASCADE,
  company TEXT NOT NULL,             -- e.g. "Google"
  role TEXT,                         -- e.g. "Software Engineer" (optional)
  start_year INTEGER,
  end_year INTEGER,                  -- leave blank if this is their current job
  is_current BOOLEAN DEFAULT false,  -- true = "Present", like on LinkedIn
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_experience_alumni_id ON work_experience(alumni_id);

ALTER TABLE work_experience ENABLE ROW LEVEL SECURITY;

-- Anyone can read work experience entries (same as the public directory)
DROP POLICY IF EXISTS "Work experience is publicly viewable" ON work_experience;
CREATE POLICY "Work experience is publicly viewable"
ON work_experience FOR SELECT
TO anon, authenticated
USING (true);

-- A logged-in alumnus can add/edit/delete ONLY their own entries
DROP POLICY IF EXISTS "Alumni manage own work experience" ON work_experience;
CREATE POLICY "Alumni manage own work experience"
ON work_experience FOR ALL
TO authenticated
USING (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
)
WITH CHECK (
  alumni_id IN (SELECT id FROM alumni WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins have full access to work experience" ON work_experience;
CREATE POLICY "Admins have full access to work experience"
ON work_experience FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');

-- ==============================================================================
-- 6. Add short_name to colleges (added 2026-07-23)
-- Full official names (e.g. "Vellore Institute of Technology") don't contain
-- their own common abbreviation (e.g. "VIT") as a substring, so searching
-- "VIT" found nothing. This column stores that abbreviation so search can
-- check both the full name AND the short form.
-- ==============================================================================

ALTER TABLE colleges ADD COLUMN IF NOT EXISTS short_name TEXT;
CREATE INDEX IF NOT EXISTS idx_colleges_short_name ON colleges(short_name);

-- ==============================================================================
-- 7. Storage policies for the "photos" bucket + missing alumni INSERT policy
-- (added 2026-07-24)
-- Supabase Storage has its own Row Level Security, separate from your
-- database tables. The "photos" bucket never had upload/read rules defined
-- here, which is why registration was failing with "new row violates
-- row-level security policy" when uploading a photo.
-- ==============================================================================

-- Let any logged-in alumnus upload into the "photos" bucket
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'photos');

-- Let a logged-in alumnus replace/delete only their own uploaded photo
DROP POLICY IF EXISTS "Users manage own photos" ON storage.objects;
CREATE POLICY "Users manage own photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'photos' AND owner = auth.uid())
WITH CHECK (bucket_id = 'photos' AND owner = auth.uid());

DROP POLICY IF EXISTS "Users delete own photos" ON storage.objects;
CREATE POLICY "Users delete own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'photos' AND owner = auth.uid());

-- Photos need to be publicly viewable (they show up on the public directory)
DROP POLICY IF EXISTS "Public read access to photos" ON storage.objects;
CREATE POLICY "Public read access to photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'photos');

-- This was missing entirely: without it, saving a BRAND NEW alumni row
-- (i.e. registration itself) has no rule allowing it, regardless of the
-- photo. Only view/update existed before, not insert.
DROP POLICY IF EXISTS "Alumni can insert own profile" ON alumni;
CREATE POLICY "Alumni can insert own profile"
ON alumni FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());