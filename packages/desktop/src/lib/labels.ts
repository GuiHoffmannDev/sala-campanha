import type { DeliveryStatus, PieceKind, PieceStatus } from '@sala/shared'

// Exact interface texts (plan, Task 6).
export const STATUS_LABELS: Record<PieceStatus, string> = {
  gerando: 'Gerando',
  base_em_revisao: 'Base em revisão',
  acabamento: 'Acabamento',
  final_em_revisao: 'Final em revisão',
  aprovada: 'Aprovada',
}

export const KIND_LABELS: Record<PieceKind, string> = {
  imagem: 'Imagem',
  texto: 'Texto',
  imagem_texto: 'Imagem e texto',
}

// Shown next to a message sent to the agent; empty once it is answered.
export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  queued: 'na fila',
  claimed: 'o agente está trabalhando',
  failed: 'falhou',
  done: '',
  not_applicable: '',
}

export const EFFORT_LABELS: Record<string, string> = {
  minimal: 'mínimo',
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'muito alto',
  max: 'máximo',
}
