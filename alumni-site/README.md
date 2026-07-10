# Alumni Site — v1 (Registration Form)

This is a working starter project. It has:
- A home page (`/`)
- A registration form page (`/register`) that saves directly into your Supabase database

## Setup (do this once)

1. **Extract this folder** somewhere clean, e.g. `Documents\alumni-site`.
2. **Open it in VS Code**: File → Open Folder → select this folder.
3. **Get your Supabase keys**:
   - Go to your Supabase project → click the gear icon (Project Settings) → API.
   - Copy the "Project URL" and the "anon public" key.
4. **Create your real env file**:
   - Duplicate `.env.local.example` and rename the copy to `.env.local`
   - Paste your Project URL and anon key into it.
5. **Install dependencies** — open the VS Code terminal (Terminal → New Terminal) and run:
   ```
   npm install
   ```
6. **Run the site**:
   ```
   npm run dev
   ```
7. Open your browser to **http://localhost:3000** — you should see the home page. Click "Register Yourself" to test the form.

## Testing it works

Fill out the form and submit. Then go to your Supabase project → Table Editor → `alumni` table — you should see your new row there with `approval_status = pending`.

## What's next (not built yet)

- Photo upload (currently skipped — "Show Photo Publicly" field exists but no upload yet)
- Directory page to browse approved alumni
- Admin approval page
- Individual profile pages

Bring this project back to the chat once this is running, and we'll build the next piece.
