import { postJson } from './http.ts'
import { ProviderError, type TextProvider } from './types.ts'

type MessagesReply = { content?: { type?: string; text?: string }[] }

/** Anthropic Messages API (`POST /v1/messages`), text out. */
export function createAnthropic(fetchFn: typeof fetch): TextProvider {
  return {
    async generateText(key, req, signal) {
      const reply = await postJson({
        provider: 'anthropic',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: { model: req.model, max_tokens: req.maxOutputTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }] },
        key, signal, fetchFn,
      }) as MessagesReply | null
      const text = (reply?.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
      if (!text) throw new ProviderError('invalid_output', 'anthropic', 'empty text output')
      return text
    },
  }
}
