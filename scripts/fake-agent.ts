import { randomInt } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { loadConfig } from '../packages/executor/src/config.ts'
import { createExecutorDb } from '../packages/executor/src/db.ts'
import { createLogger, errorText } from '../packages/executor/src/log.ts'
import type { ImageProvider, Providers, TextProvider } from '../packages/executor/src/providers/types.ts'
import { runWorker } from '../packages/executor/src/worker.ts'
import { solidPng } from '../tests/helpers/images.ts'

export function assertLocalUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (['http:', 'https:'].includes(parsed.protocol) && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
      && !parsed.username && !parsed.password) return
  } catch {
    // Invalid URLs use the same local-only error as remote hosts.
  }
  throw new Error('fake-agent só roda contra o Supabase local')
}

export function fakeAgentProviders(): Providers {
  const text: TextProvider = {
    async generateText(_key, req, signal) {
      signal.throwIfAborted()
      const request = req.prompt.split('\nPedido atual:\n').at(-1)!
      return JSON.stringify({
        image_prompt: `Teste local: ${Array.from(request).slice(0, 60).join('')}`,
        caption: `Legenda de teste ${new Date().toLocaleTimeString('pt-BR')}`,
      })
    },
  }
  const image: ImageProvider = {
    async generateImage(_key, _req, signal) {
      await sleep(3000, undefined, { signal })
      return { bytes: solidPng(512, [randomInt(256), randomInt(256), randomInt(256)]), mimeType: 'image/png' }
    },
  }
  return { text: { anthropic: text, openai: text }, image: { gemini: image, fal: image } }
}

async function main(): Promise<void> {
  process.loadEnvFile('.env.test')
  assertLocalUrl(process.env.SUPABASE_URL ?? '')
  const config = loadConfig(process.env)
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // A local URL must never redirect the service role to a remote host.
    global: { fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }) },
  })
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const log = createLogger()
  log.info('fake-agent started (local only)')
  try {
    await runWorker({
      db: (slot) => createExecutorDb(client, `fake-agent#${slot}`), providers: fakeAgentProviders(), log,
      touchIntervalMs: config.touchIntervalMs, textTimeoutMs: config.textTimeoutMs, imageTimeoutMs: config.imageTimeoutMs,
    }, config, controller.signal)
  } finally {
    controller.abort()
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${errorText(error)}\n`)
    process.exitCode = 1
  })
}
