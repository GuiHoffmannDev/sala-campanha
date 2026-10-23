-- Live updates for the collaborative tables (Plan 3 subscribes to
-- postgres_changes per piece_id). Realtime checks each INSERT/UPDATE against
-- the subscriber's RLS select policy, so members of another team receive nothing.
-- DELETE changes are not RLS-filtered and reach every subscriber of the table,
-- carrying only the primary key. Clients cannot delete from these tables; the
-- service role can (cascades from team or piece deletion), which exposes the
-- ids of deleted rows, never their content. Accepted: deletion is rare and manual.
alter publication supabase_realtime
  add table public.session_events, public.pieces, public.piece_versions, public.comments;
