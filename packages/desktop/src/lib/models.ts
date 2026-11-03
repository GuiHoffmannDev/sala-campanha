import type { PieceKind, Provider } from '@sala/shared'
import { inheritedModel, MODEL_CATALOG, type CatalogModel, type ModelCapability, type ModelChoice, type ModelRef } from '@sala/shared/agent'

export type ModelPick = { model: CatalogModel; effort: string | null }

export function modelOptions(capability: ModelCapability, keyed: Provider[]): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.capability === capability && keyed.includes(m.provider))
}

export function initialPick(choices: unknown[], capability: ModelCapability, keyed: Provider[]): ModelPick | null {
  const inherited = inheritedModel(choices, capability)
  if (inherited && keyed.includes(inherited.provider)) {
    const model = MODEL_CATALOG.find((m) => m.capability === capability && m.model === inherited.model && m.provider === inherited.provider)!
    return { model, effort: inherited.effort }
  }
  const model = modelOptions(capability, keyed)[0]
  return model ? { model, effort: null } : null
}

export function toModelChoice(kind: PieceKind, text: ModelPick, image: ModelPick | null): ModelChoice {
  const ref = ({ model, effort }: ModelPick): ModelRef => ({
    provider: model.provider, model: model.model, ...(effort === null ? {} : { effort }),
  })
  return { text: ref(text), ...(kind !== 'texto' && image ? { image: ref(image) } : {}) }
}
