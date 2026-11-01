import { buildLink, parseLink } from '../../packages/desktop/src/lib/link.ts'

const CAMPAIGN = '0b8f3c1e-5d2a-4c7b-9e1f-2a3b4c5d6e7f'
const PIECE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

it('builds and parses campaign and piece links', () => {
  expect(buildLink({ campaignId: CAMPAIGN })).toBe(`sala://campanha/${CAMPAIGN}`)
  expect(buildLink({ campaignId: CAMPAIGN, pieceId: null })).toBe(`sala://campanha/${CAMPAIGN}`)
  expect(buildLink({ campaignId: CAMPAIGN, pieceId: PIECE })).toBe(`sala://campanha/${CAMPAIGN}/peca/${PIECE}`)

  expect(parseLink(`sala://campanha/${CAMPAIGN}`)).toEqual({ campaignId: CAMPAIGN, pieceId: null })
  expect(parseLink(`sala://campanha/${CAMPAIGN}/peca/${PIECE}`)).toEqual({ campaignId: CAMPAIGN, pieceId: PIECE })
  expect(parseLink(buildLink({ campaignId: CAMPAIGN, pieceId: PIECE }))).toEqual({ campaignId: CAMPAIGN, pieceId: PIECE })
})

it('lowercases ids and accepts a trailing slash', () => {
  expect(parseLink(`sala://campanha/${CAMPAIGN.toUpperCase()}/`)).toEqual({ campaignId: CAMPAIGN, pieceId: null })
  expect(parseLink(`sala://campanha/${CAMPAIGN}/peca/${PIECE.toUpperCase()}/`)).toEqual({ campaignId: CAMPAIGN, pieceId: PIECE })
  expect(buildLink({ campaignId: CAMPAIGN.toUpperCase(), pieceId: PIECE.toUpperCase() }))
    .toBe(`sala://campanha/${CAMPAIGN}/peca/${PIECE}`)
})

it('rejects other schemes, paths and non-uuid ids', () => {
  for (const url of [
    `https://campanha/${CAMPAIGN}`,
    `sala://auth/callback?code=abc`,
    `sala://campanha/`,
    `sala://campanha`,
    `sala://campanha/123`,
    `sala://campanha/${CAMPAIGN}x`,
    `sala://campanha/${CAMPAIGN}/peca`,
    `sala://campanha/${CAMPAIGN}/peca/`,
    `sala://campanha/${CAMPAIGN}/peca/nao-e-uuid`,
    `sala://campanha/${CAMPAIGN}/peca/${PIECE}/extra`,
    `sala://campanha/${CAMPAIGN}/outra/${PIECE}`,
    `sala://campanha/${CAMPAIGN}//`,
    `sala://outra/${CAMPAIGN}`,
    `sala://campanha/${CAMPAIGN}?x=1`,
    'não é url',
    '',
  ]) {
    expect(parseLink(url), url).toBeNull()
  }
})
