/** An error whose message is already the Portuguese text to show. `friendlyError` passes it through. */
export class UserFacingError extends Error {}

const OFFLINE = 'Sem conexão com o servidor. Tente de novo.'

// Each server message (or a part of it) and the text the app shows instead.
const MESSAGES: [string, string][] = [
  ['piece not found or not writable', 'Você não pode alterar esta peça.'],
  ['message text must not be empty', 'Escreva uma mensagem.'],
  ['piece not found or not approvable', 'Só o admin ou o gestor podem aprovar.'],
  ['cannot be approved in status', 'Esta versão não pode ser aprovada na etapa atual.'],
  ['only admins and gestores can undo an approval', 'Só o admin ou o gestor podem desfazer uma aprovação.'],
  ['no previous status', 'A peça já está na primeira etapa.'],
  ['final version needs status acabamento or final_em_revisao', 'A versão final só pode ser enviada depois da aprovação da base.'],
  ['caption can only be edited on a version under review', 'Só dá para editar a legenda da versão em revisão.'],
  ['approved version cannot be edited', 'Uma versão aprovada não pode ser editada.'],
  ['only team admins can set provider keys', 'Só o admin do workspace gerencia as chaves.'],
  ['only team admins can delete provider keys', 'Só o admin do workspace gerencia as chaves.'],
  ['provider key must have at least 20 characters and no spaces', 'A chave precisa ter pelo menos 20 caracteres e nenhum espaço.'],
  ['only team admins can manage members', 'Só o admin do workspace gerencia os membros.'],
  ['only team admins can invite', 'Só o admin do workspace convida pessoas.'],
  ['team needs at least one admin', 'O workspace precisa de pelo menos um admin.'],
  ['user is already a team member', 'Essa pessoa já está no workspace.'],
  ['invalid email', 'Confira o e-mail.'],
  ['workspace name must not be empty', 'Dê um nome ao workspace.'],
  ['display name must not be empty', 'Escreva seu nome.'],
  ['provider is not enabled', 'Esse jeito de entrar ainda não está disponível.'],
  ['row-level security', 'Você não tem permissão para isso.'],
  ['Failed to fetch', OFFLINE],
  ['fetch failed', OFFLINE],
  ['NetworkError', OFFLINE],
  // WebKit, the engine of the macOS app, says "Load failed" when the network is down.
  ['Load failed', OFFLINE],
]

/** The Portuguese text for an error from Supabase, the network or the app. */
export function friendlyError(e: unknown): string {
  if (e instanceof UserFacingError) return e.message
  // PostgREST errors may arrive as plain objects with a `message`.
  const message = typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : ''
  return MESSAGES.find(([server]) => message.includes(server))?.[1] ?? 'Algo deu errado. Tente de novo.'
}
