import { friendlyError, UserFacingError } from '../../packages/desktop/src/data/errors.ts'

it('maps each server message to its Portuguese text', () => {
  const cases: [string, string][] = [
    ['piece not found or not writable', 'Você não pode alterar esta peça.'],
    ['message text must not be empty', 'Escreva uma mensagem.'],
    ['piece not found or not approvable', 'Só o admin ou o gestor podem aprovar.'],
    ['version 3 cannot be approved in status acabamento', 'Esta versão não pode ser aprovada na etapa atual.'],
    ['only admins and gestores can undo an approval', 'Só o admin ou o gestor podem desfazer uma aprovação.'],
    ['piece has no previous status', 'A peça já está na primeira etapa.'],
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
    ['Unsupported provider: provider is not enabled', 'Esse jeito de entrar ainda não está disponível.'],
    ['new row violates row-level security policy for table "campaigns"', 'Você não tem permissão para isso.'],
    ['TypeError: Failed to fetch', 'Sem conexão com o servidor. Tente de novo.'],
    ['fetch failed', 'Sem conexão com o servidor. Tente de novo.'],
    ['NetworkError when attempting to fetch resource.', 'Sem conexão com o servidor. Tente de novo.'],
    // WebKit, the engine of the macOS app, words a network failure this way.
    ['TypeError: Load failed', 'Sem conexão com o servidor. Tente de novo.'],
  ]
  for (const [server, text] of cases) expect(friendlyError(new Error(server)), server).toBe(text)
})

it('reads the message of a plain error object, as PostgREST returns it', () => {
  expect(friendlyError({ message: 'invalid email', code: '22023' })).toBe('Confira o e-mail.')
})

it('falls back to the generic text', () => {
  expect(friendlyError(new Error('something else entirely'))).toBe('Algo deu errado. Tente de novo.')
  expect(friendlyError(null)).toBe('Algo deu errado. Tente de novo.')
  expect(friendlyError('boom')).toBe('Algo deu errado. Tente de novo.')
})

it('shows an app message as it is', () => {
  expect(friendlyError(new UserFacingError('Código inválido ou vencido. Peça um novo.')))
    .toBe('Código inválido ou vencido. Peça um novo.')
})
