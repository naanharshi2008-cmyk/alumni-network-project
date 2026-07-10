# Veveaham Alumni Network

Welcome to the **Veveaham Alumni Network** repository! This is a modern, high-performance Next.js web application built to connect past students, share their journeys, and inspire the next generation. 

## ✨ Features

- **🎓 Seamless Registration:** A beautiful, multi-step registration flow for alumni to submit their academic and professional journeys.
- **📸 Secure Photo Uploads:** Direct-to-bucket image uploads using Supabase Storage (enforced limits of 5MB & image types).
- **🔒 Robust Security:** Row Level Security (RLS) ensures that pending profiles are hidden from the public API, protecting user privacy.
- **🎨 Premium UI/UX:** A bespoke design system featuring an obsidian black canvas, glassmorphism, and a gold/emerald/violet signature gradient.
- **⚡ Lightning Fast:** Built on the Next.js App Router for optimal server-side rendering and edge compatibility.

## 🛠 Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **Language:** TypeScript
- **Database & Auth:** [Supabase](https://supabase.com/) (PostgreSQL + Storage)
- **Styling:** Custom CSS Design System
- **Deployment:** Vercel 




-- Security Fix 1: INSERT on alumni (anon can only insert if status is 'pending')
-- This prevents malicious bots from sending approval_status = 'approved'
CREATE POLICY "Anon can insert pending alumni" 
ON alumni FOR INSERT 
TO anon 
WITH CHECK (approval_status = 'pending');
-- Security Fix 2: SELECT on alumni (anon can only view approved profiles)
-- This protects PII of pending users from being scraped via the API
CREATE POLICY "Anon can only view approved alumni" 
ON alumni FOR SELECT 
TO anon 
USING (approval_status = 'approved');
-- (Optional) If you have admins, don't forget they need policies too!
-- CREATE POLICY "Admins can do everything" ON alumni FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- ==============================================================================
-- 2. Storage Bucket Security (Photos)
-- ==============================================================================
-- Ensure the bucket exists and RLS is enabled on storage.objects
-- (This assumes your bucket is named 'photos')
-- Drop the old permissive insert policy if it exists
-- DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;
-- Security Fix 3: Restrict photo uploads by size (5MB max) and type (image/*)
CREATE POLICY "Restrict photo uploads by size and type"
ON storage.objects FOR INSERT 
TO public
WITH CHECK (
  bucket_id = 'photos' AND
  -- Check that size is < 5MB (5242880 bytes)
  (CASE WHEN metadata IS NOT NULL THEN (metadata->>'size')::int <= 5242880 ELSE false END) AND
  -- Check that mimetype starts with 'image/'
  (metadata->>'mimetype' LIKE 'image/%')
);


---
*Built with ❤️ for the Veveaham Alumni community.*

