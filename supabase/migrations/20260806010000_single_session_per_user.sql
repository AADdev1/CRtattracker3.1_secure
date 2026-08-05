-- Single-session-per-user enforcement (TAGIC-IR-GL-001 §3.4 / M9).
-- current_session_id holds the Supabase Auth JWT session_id claim of the
-- most recent successful login (set in signIn, src/lib/auth.functions.ts).
-- requireSessionUser (src/lib/gate.functions.ts) rejects any request whose
-- JWT session_id doesn't match this value — logging in from a second
-- device overwrites it, which is what "revokes" the first device's
-- session on its next request (no real-time push; enforced on next use).
ALTER TABLE public.user_management
  ADD COLUMN IF NOT EXISTS current_session_id text;
