import type { SupabaseClient } from '@supabase/supabase-js'
import { joinTeamPresence } from '../../packages/desktop/src/data/presence.ts'

function presenceClient() {
  let subscribed: (status: string, error?: Error) => void = () => {}
  const channel = {
    state: 'joining',
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((callback: typeof subscribed) => { subscribed = callback; return channel }),
    track: vi.fn().mockResolvedValue('ok'),
  }
  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => { channel.state = 'closed'; return 'ok' }),
  }
  return {
    client: client as unknown as SupabaseClient, raw: client, channel,
    emit(status: string, error?: Error) {
      channel.state = status === 'SUBSCRIBED' ? 'joined' : 'errored'
      subscribed(status, error)
    },
  }
}

const me = { user_id: 'me', piece_id: 'piece' }
const denied = (prefix = 'Unauthorized: ') => new Error(`${prefix}You do not have permissions to read from this Channel topic: team:team`, {
  cause: { reason: `${prefix}You do not have permissions to read from this Channel topic: team:team` },
})

it.each(['CHANNEL_ERROR', 'TIMED_OUT'])('recovers from an initial %s without removing the private channel', async (status) => {
  const f = presenceClient()
  const sync = vi.fn()
  const joining = joinTeamPresence(f.client, 'team', me, sync)
  const result = joining.then((handle) => ({ handle }), (error: unknown) => ({ error }))
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  f.emit(status, new Error('Realtime is restarting', { cause: { reason: 'Realtime is restarting' } }))
  await Promise.resolve()
  f.emit('SUBSCRIBED')
  const outcome = await result
  expect(outcome).toHaveProperty('handle')
  expect(f.raw.removeChannel).not.toHaveBeenCalled()
  expect(f.raw.channel).toHaveBeenCalledWith('team:team', {
    config: { private: true, presence: { key: me.user_id } },
  })
  expect(f.channel.track).toHaveBeenCalledWith(me)
  if ('handle' in outcome) await outcome.handle.leave()
})

it.each(['Unauthorized: ', ''])('rejects an authorization denial with prefix "%s" and removes the channel', async (prefix) => {
  const f = presenceClient()
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn())
  const failure = expect(joining).rejects.toThrow('You do not have permissions')
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  f.emit('CHANNEL_ERROR', denied(prefix))
  await failure
  expect(f.raw.removeChannel).toHaveBeenCalledOnce()
  expect(f.channel.track).not.toHaveBeenCalled()
})

it('recovers when the first track fails during a dropped socket', async () => {
  const f = presenceClient()
  f.channel.track.mockImplementationOnce(async () => { f.channel.state = 'errored'; return 'timed out' })
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn())
  const result = joining.then((handle) => ({ handle }), (error: unknown) => ({ error }))
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  f.emit('SUBSCRIBED')
  await vi.waitFor(() => expect(f.channel.track).toHaveBeenCalledOnce())
  f.emit('SUBSCRIBED')
  const outcome = await result
  expect(outcome).toHaveProperty('handle')
  expect(f.raw.removeChannel).not.toHaveBeenCalled()
  if ('handle' in outcome) await outcome.handle.leave()
})

it('retries a first track timeout while still joined and cancels its timer on leave', async () => {
  const f = presenceClient()
  f.channel.track.mockResolvedValueOnce('timed out')
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn())
  const result = joining.then((handle) => ({ handle }), (error: unknown) => ({ error }))
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  vi.useFakeTimers()
  try {
    f.emit('SUBSCRIBED')
    await vi.advanceTimersByTimeAsync(3_000)
    const outcome = await result
    expect(outcome).toHaveProperty('handle')
    expect(f.channel.track).toHaveBeenCalledTimes(2)
    if ('handle' in outcome) await outcome.handle.leave()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(f.channel.track).toHaveBeenCalledTimes(2)
  } finally { vi.useRealTimers() }
})

it('cancels a scheduled first-track retry when the pending join is aborted', async () => {
  const f = presenceClient()
  const controller = new AbortController()
  f.channel.track.mockResolvedValueOnce('error')
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn(), controller.signal)
  const result = joining.catch((error: unknown) => error)
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  vi.useFakeTimers()
  try {
    f.emit('SUBSCRIBED')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.channel.track).toHaveBeenCalledOnce()
    controller.abort()
    expect(await result).toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(f.channel.track).toHaveBeenCalledOnce()
    expect(f.raw.removeChannel).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})

it('cancels a pending join and ignores a later subscription', async () => {
  const f = presenceClient()
  const controller = new AbortController()
  let settled = false
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn(), controller.signal)
  const result = joining.then(() => { settled = true; return null }, (error: unknown) => { settled = true; return error })
  await vi.waitFor(() => expect(f.channel.subscribe).toHaveBeenCalledOnce())
  controller.abort()
  try {
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 })
    expect(await result).toMatchObject({ name: 'AbortError' })
    expect(f.raw.removeChannel).toHaveBeenCalledOnce()
    f.emit('SUBSCRIBED')
    expect(f.channel.track).not.toHaveBeenCalled()
  } finally {
    if (!settled) f.emit('CHANNEL_ERROR', denied())
    await result
  }
})

it('does not authenticate or create a channel when already cancelled', async () => {
  const f = presenceClient()
  const controller = new AbortController()
  controller.abort()
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn(), controller.signal)
  void joining.catch(() => {})
  try {
    await Promise.resolve()
    expect(f.raw.realtime.setAuth).not.toHaveBeenCalled()
    expect(f.raw.channel).not.toHaveBeenCalled()
    await expect(joining).rejects.toMatchObject({ name: 'AbortError' })
  } finally {
    f.emit('CHANNEL_ERROR', denied())
    await joining.catch(() => {})
  }
})

it('does not create a channel when cancelled while authenticating', async () => {
  const f = presenceClient()
  const controller = new AbortController()
  let authenticated = () => {}
  f.raw.realtime.setAuth.mockImplementation(() => new Promise<void>((resolve) => { authenticated = resolve }))
  const joining = joinTeamPresence(f.client, 'team', me, vi.fn(), controller.signal)
  controller.abort()
  authenticated()
  await expect(joining).rejects.toMatchObject({ name: 'AbortError' })
  expect(f.raw.channel).not.toHaveBeenCalled()
})
