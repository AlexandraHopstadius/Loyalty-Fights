-- Supabase migration: create fights, metadata and audit tables + RLS policies

-- TABLE: fights
CREATE TABLE IF NOT EXISTS fights (
  id serial PRIMARY KEY,
  ord integer NOT NULL,
  a text NOT NULL,
  b text NOT NULL,
  weight text,
  klass text,
  winner text, -- 'a','b','draw' or NULL
  updated_at timestamptz DEFAULT now()
);

-- TABLE: metadata (singleton rows for state)
CREATE TABLE IF NOT EXISTS metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- TABLE: audit
CREATE TABLE IF NOT EXISTS audit (
  id serial PRIMARY KEY,
  actor text, -- admin user id or identifier
  action text NOT NULL,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.fights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit ENABLE ROW LEVEL SECURITY;

-- Allow anonymous (public) SELECT on fights and metadata
CREATE POLICY "anon_select_fights" ON public.fights
  FOR SELECT
  USING (true);

CREATE POLICY "anon_select_metadata" ON public.metadata
  FOR SELECT
  USING (true);

-- Allow inserts/updates/deletes only for admin-authenticated sessions
-- This policy assumes your JWT contains a custom claim `is_admin = "true"` for admin users.
-- In Supabase SQL, the JWT claims are available via current_setting('request.jwt.claims', true)

-- Admin policies for `fights`: create operation-specific policies because
-- INSERT policies may only provide a WITH CHECK expression (USING is not
-- applicable for INSERT). Using FOR ALL with a USING clause causes the
-- "only WITH CHECK expression allowed for INSERT" error.

CREATE POLICY "admins_insert_fights" ON public.fights
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

CREATE POLICY "admins_update_fights" ON public.fights
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

CREATE POLICY "admins_delete_fights" ON public.fights
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

-- Admin policies for `metadata` (state)
CREATE POLICY "admins_insert_metadata" ON public.metadata
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

CREATE POLICY "admins_update_metadata" ON public.metadata
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

CREATE POLICY "admins_delete_metadata" ON public.metadata
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

-- Audit policy: allow insert by admins (so we can write audit rows from admin UI/edge functions)
-- Audit insert policy: for INSERT use WITH CHECK (USING is not applicable)
CREATE POLICY "admins_insert_audit" ON public.audit
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    current_setting('request.jwt.claims.is_admin', true) = 'true'
  );

-- Seed a default metadata row for state (optional). Update values after you import your fights.
INSERT INTO public.metadata(key, value) VALUES
  ('state', '{"current": 0, "standby": false, "infoVisible": true}')
ON CONFLICT (key) DO NOTHING;

-- Index to help ordering
CREATE INDEX IF NOT EXISTS fights_ord_idx ON public.fights(ord);

-- Notes for migration:
-- 1) Run this SQL in the Supabase SQL editor for your project.
-- 2) After running, insert your fights into the `fights` table (see README for examples).
-- 3) Make sure you create admin users and set the is_admin claim (see README).
