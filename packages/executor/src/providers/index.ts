import { createAnthropic } from './anthropic.ts'
import { createFal } from './fal.ts'
import { createGemini } from './gemini.ts'
import { createOpenAI } from './openai.ts'
import type { Providers } from './types.ts'

/** The real provider adapters. */
export function createProviders(fetchFn: typeof fetch = fetch): Providers {
  return {
    text: { anthropic: createAnthropic(fetchFn), openai: createOpenAI(fetchFn) },
    image: { gemini: createGemini(fetchFn), fal: createFal(fetchFn) },
  }
}
