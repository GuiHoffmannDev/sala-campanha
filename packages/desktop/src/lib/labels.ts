import type { PieceKind, PieceStatus } from '@sala/shared'

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
