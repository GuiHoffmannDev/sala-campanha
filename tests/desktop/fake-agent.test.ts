import { inflateSync } from 'node:zlib'
import { assertLocalUrl, fakeAgentProviders } from '../../scripts/fake-agent.ts'
import { parsePlan } from '../../packages/executor/src/orchestrator.ts'
import { sniffType } from '../../packages/executor/src/providers/image.ts'

it('refuses a non-local Supabase URL', () => {
  for (const url of ['https://example.supabase.co', 'http://127.0.0.1.evil.test', 'invalid', 'http://localhost@evil.test']) {
    expect(() => assertLocalUrl(url)).toThrow('fake-agent só roda contra o Supabase local')
  }
  expect(() => assertLocalUrl('http://127.0.0.1:55321')).not.toThrow()
  expect(() => assertLocalUrl('http://localhost:55321')).not.toThrow()
})

it('fake providers answer with a plan parsePlan accepts and a real PNG', async () => {
  const providers = fakeAgentProviders()
  const request = 'Um produto azul com fundo branco'
  const raw = await providers.text.anthropic!.generateText('ignored', {
    model: 'fake', system: '', prompt: `Histórico:\nPedido antigo\nPedido atual:\n[#1] Ana: ${request}`, maxOutputTokens: 1000,
  }, new AbortController().signal)
  for (const kind of ['texto', 'imagem', 'imagem_texto'] as const) {
    const plan = parsePlan(raw, kind, 'anthropic')
    if (kind !== 'texto') expect(plan.imagePrompt).toBe(`Teste local: [#1] Ana: ${request}`)
    if (kind !== 'imagem') expect(plan.caption).toMatch(/^Legenda de teste /)
  }
  const started = Date.now()
  const image = await providers.image.gemini!.generateImage('ignored', { model: 'fake', prompt: '', images: [] }, new AbortController().signal)
  expect(Date.now() - started).toBeGreaterThanOrEqual(2900)
  expect(sniffType(image.bytes)).toBe('image/png')
  const png = Buffer.from(image.bytes)
  expect(png.readUInt32BE(16)).toBe(512)
  expect(png.readUInt32BE(20)).toBe(512)
  const headerEnd = 33
  const length = png.readUInt32BE(headerEnd)
  expect(inflateSync(png.subarray(headerEnd + 8, headerEnd + 8 + length))).toHaveLength(512 * (1 + 512 * 3))
})
