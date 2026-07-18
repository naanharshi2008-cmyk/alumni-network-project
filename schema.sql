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
CREATE POLICY "Alumni can view own profile" 
ON alumni FOR SELECT 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email());

-- Allow alumni to update their own profile
CREATE POLICY "Alumni can update own profile" 
ON alumni FOR UPDATE 
TO authenticated 
USING (user_id = auth.uid() OR personal_email = auth.email())
WITH CHECK (user_id = auth.uid() OR personal_email = auth.email());

-- Ensure admins (staff) can do everything
-- Note: Replace with proper check if you have a custom admin role/email claim
CREATE POLICY "Admins have full access"
ON alumni FOR ALL
TO authenticated
USING (auth.email() LIKE '%@veveaham-admin.local')
WITH CHECK (auth.email() LIKE '%@veveaham-admin.local');
