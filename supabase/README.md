Supabase setup notes for `fightcard-admin`

This folder contains a minimal migration and examples to wire Supabase as the backend for the fight card.

Steps to get running

1) Create a Supabase project
   - Go to app.supabase.com and create a new project for your `fightcard-admin` org.

2) Run the SQL migration
   - Open the SQL editor in the Supabase dashboard and paste the contents of `migrations/001_init.sql`.
   - Run it to create `fights`, `metadata` and `audit` tables and RLS policies.

3) Seed your fights
   - Insert your fights into `public.fights`. Example SQL:

     INSERT INTO public.fights (ord, a, b, weight, klass) VALUES
       (1, 'Axel Toll', 'Leon Ländin', '-44 kg', 'JR-D Herr'),
       (2, 'Viktor Papay', 'Emil Söderlund', '-54 kg', 'JR-D Herr');

   - Or use the Supabase Table editor to paste rows.

4) Create Admin Users
   - Use Supabase Auth to invite/enable admin users (email sign-up or magic link).
   - You must add a custom claim `is_admin` to the admin user's JWT to satisfy the RLS policy.
     There are two approaches:
     a) Use a server-side function (Edge Function) that issues admin tokens (signs a JWT containing is_admin = "true").
     b) After a user signs up, set a flag in a `profiles` table and use a Postgres Row-Level Security policy that reads the flag. (Simpler: create a single service_role key to run administrative operations server-side; avoid exposing it to the browser.)

   - Quick dev approach: Use the Supabase "service_role" key in a safe server-side place (not in the browser) or create a simple Edge Function that checks a password and returns a short-lived admin token.

5) Viewer wiring (public site)
   - Use the public anon key in the browser to perform SELECTs and subscribe to realtime changes.
   - See `viewer-supabase.js` for a minimal example on how to fetch initial state and subscribe.

6) Admin UI
   - Use `admin-supabase.html` as a starting point. Host it on Render (or any static hosting). The admin UI signs in and performs write operations using `supabase-js`.

Security notes
- Never use the `service_role` key in browser/client code.
- Prefer server-side edge functions or short-lived admin tokens for write operations from the admin UI.
- Alternatively, keep RLS policies strict and grant write permissions only to sessions with `is_admin=true`.

If you want, I can:
- generate SQL to import your existing `fights.json` rows automatically,
- scaffold an Edge Function to mint admin tokens,
- or add a safe admin endpoint to the repo that calls the Supabase service_role key server-side and performs updates (so you don't need to handle JWT claims in the browser).

Tell me which of the above you'd like me to scaffold next.