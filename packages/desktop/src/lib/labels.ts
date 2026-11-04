import type { DeliveryStatus, PieceKind, PieceStatus, Role } from '@sala/shared'

// Exact interface texts (plan, Task 6).
export const STATUS_LABELS: Record<PieceStatus, string> = {
  gerando: 'Generating',
  base_em_revisao: 'Base under review',
  acabamento: 'Finishing',
  final_em_revisao: 'Final under review',
  aprovada: 'Approved',
}

export const KIND_LABELS: Record<PieceKind, string> = {
  imagem: 'Image',
  texto: 'Text',
  imagem_texto: 'Image and text',
}

// Shown next to a message sent to the agent; empty once it is answered.
export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  queued: 'queued',
  claimed: 'the agent is working',
  failed: 'failed',
  done: '',
  not_applicable: '',
}

export const EFFORT_LABELS: Record<string, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'very high',
  max: 'maximum',
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  gestor: 'Manager',
  designer: 'Designer',
  espectador: 'Viewer',
}
