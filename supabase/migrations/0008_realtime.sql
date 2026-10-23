-- Live updates for the collaborative tables (Plan 3 subscribes to
-- postgres_changes per piece_id). Realtime checks each change against the
-- subscriber's RLS select policy, so members of another team receive nothing.
-- DELETE changes are not RLS-filtered by Realtime; none of these tables grants
-- delete to authenticated, so no row content can leak that way.
alter publication supabase_realtime
  add table public.session_events, public.pieces, public.piece_versions, public.comments;
