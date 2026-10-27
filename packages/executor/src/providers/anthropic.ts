import { postJson, redact } from './http.ts'
import { ProviderError, type TextProvider } from './types.ts'

type MessagesReply = {
  stop_reason?: string
  stop_details?: { category?: unknown } | null
  content?: { type?: string; text?: string }[]
}

/** Anthropic Messages API (`POST /v1/messages`), text out. */
export function createAnthropic(fetchFn: typeof fetch): TextProvider {
  return {
    async generateText(key, req, signal) {
      const reply = await postJson({
        provider: 'anthropic',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: {
          model: req.model, max_tokens: req.maxOutputTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }],
          ...(req.effort && { output_config: { effort: req.effort } }),
        },
        key, signal, fetchFn,
      }) as MessagesReply | null
      // Text cut at the token limit is partial output, not a usable answer.
      if (reply?.stop_reason === 'max_tokens') throw new ProviderError('invalid_output', 'anthropic', 'output truncated (max_tokens)')
      // A refusal arrives as HTTP 200 with empty content (declined before output) or partial text
      // (declined mid-generation); neither is a usable answer. `stop_details` may be null.
      if (reply?.stop_reason === 'refusal') {
        const category = reply.stop_details?.category
        const shown = typeof category === 'string' && category ? redact(category, key).slice(0, 100) : 'unknown'
        throw new ProviderError('invalid_output', 'anthropic', `refused (${shown})`)
      }
      const text = (reply?.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
      if (!text) throw new ProviderError('invalid_output', 'anthropic', 'empty text output')
      return text
    },
  }
}
