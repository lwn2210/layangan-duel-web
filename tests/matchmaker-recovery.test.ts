import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Matchmaker } from '../src/net/online'

class Socket extends EventTarget {
  static instances: Socket[] = []
  close = vi.fn(() => this.dispatchEvent(new Event('close')))
  constructor(_url: string) { super(); Socket.instances.push(this) }
  message(data: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
}
beforeEach(() => {
  vi.useFakeTimers(); Socket.instances = []
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('window', globalThis)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('fails once at 10 seconds when the matchmaking transport stays silent', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  new Matchmaker(handlers)
  vi.advanceTimersByTime(9999); expect(handlers.failed).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1); expect(handlers.failed).toHaveBeenCalledOnce()
  expect(Socket.instances[0]!.close).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(30000); expect(handlers.failed).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('accepts a match before the deadline and suppresses late events', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  new Matchmaker(handlers)
  const socket = Socket.instances[0]!
  socket.message({ t: 'matched', code: 'ABCDE' })
  socket.message({ t: 'matched', code: 'FGHIJ' })
  vi.advanceTimersByTime(30000)
  expect(handlers.matched).toHaveBeenCalledExactlyOnceWith('ABCDE')
  expect(handlers.failed).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('does not treat socket-open or malformed messages as queue acknowledgement', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  new Matchmaker(handlers)
  const socket = Socket.instances[0]!
  socket.dispatchEvent(new Event('open'))
  socket.dispatchEvent(new MessageEvent('message', { data: '{' }))
  socket.message({ t: 'pong', at: 0 })
  vi.advanceTimersByTime(10000)
  expect(handlers.failed).toHaveBeenCalledOnce()
})
it('reports early transport closure only once and clears the deadline', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  new Matchmaker(handlers)
  const socket = Socket.instances[0]!
  socket.dispatchEvent(new Event('close'))
  socket.dispatchEvent(new Event('close'))
  vi.advanceTimersByTime(30000)
  expect(handlers.failed).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps an acknowledged queue alive beyond the connection deadline', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  const match = new Matchmaker(handlers)
  Socket.instances[0]!.message({ t: 'queued', waiting: 1 })
  vi.advanceTimersByTime(30000)
  expect(handlers.queued).toHaveBeenCalledWith(1)
  expect(handlers.failed).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
  match.close()
})
it('ignores messages after cancellation and releases the deadline', () => {
  const handlers = { queued: vi.fn(), matched: vi.fn(), failed: vi.fn() }
  const match = new Matchmaker(handlers)
  match.close()
  const socket = Socket.instances[0]!
  socket.message({ t: 'queued', waiting: 1 })
  socket.message({ t: 'matched', code: 'ABCDE' })
  vi.advanceTimersByTime(30000)
  expect(handlers.queued).not.toHaveBeenCalled()
  expect(handlers.matched).not.toHaveBeenCalled()
  expect(handlers.failed).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
