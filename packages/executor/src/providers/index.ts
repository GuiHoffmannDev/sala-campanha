import { createAnthropic } from './anthropic.ts'
import { createOpenAI } from './openai.ts'
import type { Providers } from './types.ts'

/** The real provider adapters. Image providers arrive in later tasks. */
export function createProviders(fetchFn: typeof fetch = fetch): Providers {
  return {
    text: { anthropic: createAnthropic(fetchFn), openai: createOpenAI(fetchFn) },
    image: {},
  }
}
