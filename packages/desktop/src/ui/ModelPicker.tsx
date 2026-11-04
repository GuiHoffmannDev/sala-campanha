import type { CatalogModel, ModelCapability } from '@sala/shared/agent'
import { EFFORT_LABELS } from '../lib/labels.ts'
import type { ModelPick } from '../lib/models.ts'

type Props = {
  capability: ModelCapability
  options: CatalogModel[]
  value: ModelPick
  onChange(pick: ModelPick): void
}

export function ModelPicker({ capability, options, value, onChange }: Props) {
  const name = capability === 'text' ? 'Text' : 'Image'
  return <div className="model-picker">
    <label>{name} model
      <select value={value.model.model} onChange={(e) => {
        const model = options.find((m) => m.model === e.target.value)
        if (model) onChange({ model, effort: null })
      }}>
        {options.map((m) => <option key={m.model} value={m.model}>{m.label}</option>)}
      </select>
    </label>
    {value.model.efforts.length > 0 && <label>{name} effort
      <select value={value.effort ?? ''} onChange={(e) => onChange({ ...value, effort: e.target.value || null })}>
        <option value="">Provider default</option>
        {value.model.efforts.map((effort) => <option key={effort} value={effort}>{EFFORT_LABELS[effort]}</option>)}
      </select>
    </label>}
  </div>
}
