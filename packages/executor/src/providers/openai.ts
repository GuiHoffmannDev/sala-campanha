import { postJson, redact } from './http.ts'
import { ProviderError, type TextProvider } from './types.ts'

type ResponsesReply = {
  status?: string
  incomplete_details?: { reason?: unknown } | null
  output?: { type?: string; content?: { type?: string; text?: string }[] }[]
}

/** OpenAI Responses API (`POST /v1/responses`), text out. */
export function createOpenAI(fetchFn: typeof fetch): TextProvider {
  return {
    async generateText(key, req, signal) {
      const reply = await postJson({
        provider: 'openai',
        url: 'https://api.openai.com/v1/responses',
        headers: { Authorization: `Bearer ${key}` },
        body: {
          model: req.model, instructions: req.system, input: req.prompt, max_output_tokens: req.maxOutputTokens,
          ...(req.effort && { reasoning: { effort: req.effort } }),
        },
        key, signal, fetchFn,
      }) as ResponsesReply | null
      // An incomplete response (token limit, content filter) carries partial output, not a usable answer.
      if (reply?.status === 'incomplete') {
        const reason = reply.incomplete_details?.reason
        const shown = typeof reason === 'string' && reason ? redact(reason, key).slice(0, 100) : 'unknown'
        throw new ProviderError('invalid_output', 'openai', `output incomplete (${shown})`)
      }
      const text = (reply?.output ?? [])
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('')
      if (!text) throw new ProviderError('invalid_output', 'openai', 'empty text output')
      return text
    },
  }
}
