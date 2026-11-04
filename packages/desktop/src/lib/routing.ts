export type Mention = { userId: string; name: string }

/** Finds complete names, longest first, preserving their first appearance in the message. */
export function mentionedIn(text: string, members: Mention[]): Mention[] {
  const names = [...members].filter((m) => m.name).sort((a, b) => b.name.length - a.name.length)
  const found: Mention[] = []
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    const member = names.find((m) => text.startsWith(m.name, at + 1)
      && !/^[\p{L}\p{N}_]/u.test(text.slice(at + 1 + m.name.length)))
    if (member) {
      if (!found.some((m) => m.userId === member.userId)) found.push(member)
      at += member.name.length
    }
  }
  return found
}

export function messageTarget(text: string, mentioned: Mention[]): { toAgent: boolean; label: string } {
  // Match post_message's leading whitespace, including the zero-width space omitted by JS trim.
  // PostgreSQL also treats U+001C–U+001F and U+0085 as whitespace.
  const toAgent = !(text.replace(/^[\s\u001c-\u001f\u0085\u200b]+/u, '').startsWith('@') && mentioned.length > 0)
  const names = mentioned.map((m) => `@${m.name}`)
  const people = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return { toAgent, label: toAgent ? 'To the agent' : `To ${people}` }
}

export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  return query.length <= 30 && !/[\r\n]/.test(query) ? query : null
}
