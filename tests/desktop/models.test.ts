import { MODEL_CATALOG, ModelChoiceSchema } from '../../packages/shared/src/agent.ts'
import { initialPick, modelOptions, toModelChoice } from '../../packages/desktop/src/lib/models.ts'

const sonnet = MODEL_CATALOG.find((m) => m.model === 'claude-sonnet-5-5')!
const gpt = MODEL_CATALOG.find((m) => m.model === 'gpt-6-astra')!
const banana = MODEL_CATALOG.find((m) => m.model === 'gemini-nano-banana-2.1')!

it('lists only models whose provider has a key', () => {
  expect(modelOptions('text', ['openai', 'gemini']).map((m) => m.model)).toEqual(['gpt-6-astra'])
  expect(modelOptions('image', ['gemini', 'fal']).map((m) => m.model))
    .toEqual(['gemini-nano-banana-2.1', 'fal-ai/flux-pro/kontext/max/multi', 'gemini-3-pro-image'])
  expect(modelOptions('text', [])).toEqual([])
})

it('initialPick inherits per capability and falls back when the provider has no key', () => {
  const choices = [
    { image: { provider: 'gemini', model: 'gemini-nano-banana-2.1', effort: 'high' } },
    { text: { provider: 'openai', model: 'gpt-6-astra', effort: 'medium' } },
    { text: { provider: 'openai', model: 'unknown' } },
  ]
  expect(initialPick(choices, 'text', ['openai', 'anthropic'])).toEqual({ model: gpt, effort: 'medium' })
  expect(initialPick(choices, 'image', ['gemini'])).toEqual({ model: banana, effort: 'high' })
  expect(initialPick(choices, 'text', ['anthropic'])).toEqual({ model: sonnet, effort: null })
  expect(initialPick(choices, 'text', ['gemini'])).toBeNull()
})

it('toModelChoice sends the image model only for image pieces and omits a null effort', () => {
  const text = { model: gpt, effort: null }
  const image = { model: banana, effort: 'high' }
  expect(toModelChoice('texto', text, image)).toEqual({ text: { provider: 'openai', model: 'gpt-6-astra' } })
  for (const kind of ['imagem', 'imagem_texto'] as const) {
    const choice = toModelChoice(kind, text, image)
    expect(choice).toEqual({ text: { provider: 'openai', model: 'gpt-6-astra' },
      image: { provider: 'gemini', model: 'gemini-nano-banana-2.1', effort: 'high' } })
    expect(ModelChoiceSchema.safeParse(choice).success).toBe(true)
  }
  expect(toModelChoice('imagem', { model: gpt, effort: 'max' }, null))
    .toEqual({ text: { provider: 'openai', model: 'gpt-6-astra', effort: 'max' } })
})
