import { friendlyError, UserFacingError } from '../../packages/desktop/src/data/errors.ts'

it('reads the message of a plain error object, as PostgREST returns it', () => {
  expect(friendlyError({ message: 'invalid email', code: '22023' })).toBe('Check the email address.')
})

it('falls back to the generic text', () => {
  expect(friendlyError(new Error('something else entirely'))).toBe('Something went wrong. Try again.')
  expect(friendlyError(null)).toBe('Something went wrong. Try again.')
  expect(friendlyError('boom')).toBe('Something went wrong. Try again.')
})

it('shows an app message as it is', () => {
  expect(friendlyError(new UserFacingError('Invalid or expired code. Request a new one.')))
    .toBe('Invalid or expired code. Request a new one.')
})
