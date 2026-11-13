import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnlineGame } from '../src/net/online'

// Transport stub only: the real browser regression also holds a real TCP
// upgrade open without returning a WebSocket handshake.
class Socket extends EventTarget {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.dispatchEvent(new Event('close')) })
  constructor(_url: string) { super(); Socket.instances.push(this) }
  message(data: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
}

beforeEach(() => {
  vi.useFakeTimers()
  Socket.instances = []
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('room connection recovery', () => {
  it('reports failure and releases a socket whose handshake never completes', () => {
    const status = vi.fn()
    new OnlineGame('ABCDE', 'Ucup', status)
    vi.advanceTimersByTime(10000)
    expect(status.mock.calls.at(-1)?.[0].kind).toBe('error')
    expect(Socket.instances[0]!.close).toHaveBeenCalledOnce()
    expect(status.mock.calls.filter(([s]) => s.kind === 'error')).toHaveLength(1)
  })

  it('does not time out an accepted room while waiting for a friend', () => {
    const status = vi.fn()
    const game = new OnlineGame('ABCDE', 'Ucup', status)
    const socket = Socket.instances[0]!
    socket.open()
    socket.message({ t: 'welcome', slot: 0, code: 'ABCDE' })
    socket.message({ t: 'waiting' })
    vi.advanceTimersByTime(30000)
    expect(status.mock.calls.at(-1)?.[0]).toEqual({ kind: 'waiting', code: 'ABCDE' })
    expect(socket.close).not.toHaveBeenCalled()
    game.close()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases the deadline on cancel and ignores late messages', () => {
    const status = vi.fn()
    const game = new OnlineGame('ABCDE', 'Ucup', status)
    game.close()
    Socket.instances[0]!.message({ t: 'waiting' })
    vi.advanceTimersByTime(30000)
    expect(status).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not report a second error after an early disconnect', () => {
    const status = vi.fn()
    new OnlineGame('ABCDE', 'Ucup', status)
    Socket.instances[0]!.dispatchEvent(new Event('close'))
    vi.advanceTimersByTime(30000)
    expect(status.mock.calls.filter(([s]) => s.kind === 'error')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out a socket that opens but never receives a room welcome', () => {
    const status = vi.fn()
    new OnlineGame('ABCDE', 'Ucup', status)
    Socket.instances[0]!.open()
    vi.advanceTimersByTime(10000)
    expect(status.mock.calls.at(-1)?.[0].kind).toBe('error')
    expect(vi.getTimerCount()).toBe(0)
  })
})
