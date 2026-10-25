import { postJson } from './http.ts'
import { ProviderError, type TextProvider } from './types.ts'

type ResponsesReply = { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }

/** OpenAI Responses API (`POST /v1/responses`), text out. */
export function createOpenAI(fetchFn: typeof fetch): TextProvider {
  return {
    async generateText(key, req, signal) {
      const reply = await postJson({
        provider: 'openai',
        url: 'https://api.openai.com/v1/responses',
        headers: { Authorization: `Bearer ${key}` },
        body: { model: req.model, instructions: req.system, input: req.prompt, max_output_tokens: req.maxOutputTokens },
        key, signal, fetchFn,
      }) as ResponsesReply | null
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
