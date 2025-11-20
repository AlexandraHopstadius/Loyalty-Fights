-- Import fights from fights.json
-- Run this after 001_init.sql in the Supabase SQL editor

BEGIN;

-- Remove any existing rows (optional)
DELETE FROM public.fights;

INSERT INTO public.fights (ord, a, b, weight, klass, winner) VALUES
(1, 'Axel Toll', 'Leon Ländin', '-44 kg', 'JR-D Herr', NULL),
(2, 'Viktor Papay', 'Emil Söderlund', '-54 kg', 'JR-D Herr', NULL),
(3, 'Saga Lundström', 'Sava Kader', '-51 kg', 'C Dam', NULL),
(4, 'Erica Englin', 'Mandana Yousifi', '-54 kg', 'C Dam', NULL),
(5, 'Freddy Hellman', 'Dennis Sjögren Reis', '-67 kg', 'C Herr', NULL),
(6, 'Texas Sjöden', 'Daniel Chikowski Bredenberg', '-71 kg', 'JR-C Herr', NULL),
(7, 'Tora Grant', 'Samina Burgaj', '-62 kg', 'C Dam', NULL),
(8, 'Vilmer Albinsson', 'William Nyberg', '-67 kg', 'JR-C Herr', NULL);

-- Update metadata state current index (0-based): fights.json had current=4
-- We'll set the state.current to 4 (you can change it later in dashboard)
INSERT INTO public.metadata (key, value)
VALUES ('state', '{"current": 4, "standby": false, "infoVisible": true}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

COMMIT;
