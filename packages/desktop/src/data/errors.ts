/** An error whose message is already the English text to show. `friendlyError` passes it through. */
export class UserFacingError extends Error {}

const OFFLINE = 'Cannot connect to the server. Try again.'

// Each server message (or a part of it) and the text the app shows instead.
const MESSAGES: [string, string][] = [
  ['piece not found or not writable', 'You cannot edit this piece.'],
  ['message text must not be empty', 'Write a message.'],
  ['piece not found or not approvable', 'Only an admin or manager can approve.'],
  ['cannot be approved in status', 'This version cannot be approved at the current stage.'],
  ['only admins and gestores can undo an approval', 'Only an admin or manager can undo an approval.'],
  ['no previous status', 'The piece is already at the first stage.'],
  ['final version needs status acabamento or final_em_revisao', 'The final version can only be uploaded after the base is approved.'],
  ['caption can only be edited on a version under review', 'Only the caption of the version under review can be edited.'],
  ['approved version cannot be edited', 'An approved version cannot be edited.'],
  ['only team admins can set provider keys', 'Only a workspace admin can manage keys.'],
  ['only team admins can delete provider keys', 'Only a workspace admin can manage keys.'],
  ['provider key must have at least 20 characters and no spaces', 'The key must have at least 20 characters and no spaces.'],
  ['only team admins can manage members', 'Only a workspace admin can manage members.'],
  ['only team admins can invite', 'Only a workspace admin can invite people.'],
  ['team needs at least one admin', 'The workspace needs at least one admin.'],
  ['user is already a team member', 'This person is already in the workspace.'],
  ['invalid email', 'Check the email address.'],
  ['workspace name must not be empty', 'Give your workspace a name.'],
  ['display name must not be empty', 'Enter your name.'],
  ['provider is not enabled', 'This sign-in method is not available yet.'],
  ['row-level security', 'You do not have permission to do this.'],
  ['Failed to fetch', OFFLINE],
  ['fetch failed', OFFLINE],
  ['NetworkError', OFFLINE],
  // WebKit, the engine of the macOS app, says "Load failed" when the network is down.
  ['Load failed', OFFLINE],
]

/** The English text for an error from Supabase, the network or the app. */
export function friendlyError(e: unknown): string {
  if (e instanceof UserFacingError) return e.message
  // PostgREST errors may arrive as plain objects with a `message`.
  const message = typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : ''
  return MESSAGES.find(([server]) => message.includes(server))?.[1] ?? 'Something went wrong. Try again.'
}
