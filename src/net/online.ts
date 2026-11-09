import { TICK_RATE } from '../sim/constants'
import type { Input, MatchState, SimEvent } from '../sim/match'
import { mirrorEvent, mirrorInput, mirrorState } from './mirror'
import { PROTOCOL, SNAP_EVERY, type ServerMsg, type Slot } from './protocol'

// The client side of an online duel. Everything it hands the game is already
// seen from the local player's side (mirrored for slot 1), so the renderer,
// HUD and sound always treat the local player as kite 0.

export function serverUrl(path: string): string {
  const base = import.meta.env.VITE_SERVER_URL as string | undefined
  if (base) return base.replace(/\/$/, '') + path
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`
}

export interface Snapshot {
  state: MatchState
  events: SimEvent[]
}

export type OnlineStatus =
  | { kind: 'connecting' }
  | { kind: 'waiting'; code: string }
  | { kind: 'playing'; names: [string, string] }
  | { kind: 'rematch'; from: 'me' | 'them' }
  | { kind: 'left' }
  | { kind: 'full' }
  | { kind: 'error'; reason: string }

export class OnlineGame {
  readonly snapInterval = (SNAP_EVERY / TICK_RATE) * 1000
  slot: Slot | null = null
  /** [me, opponent]. */
  names: [string, string] = ['Kamu', 'Lawan']
  ping = 0
  private ws: WebSocket
  private inbox: Snapshot[] = []
  private lastSent: Input | null = null
  private lastSentAt = 0
  private pinger = 0
  private ended = false

  constructor(
    readonly code: string,
    name: string,
    private readonly onStatus: (status: OnlineStatus) => void,
  ) {
    this.ws = new WebSocket(serverUrl(`/ws/room/${code}`))
    this.ws.addEventListener('open', () => {
      this.send({ t: 'hello', v: PROTOCOL, name })
      this.pinger = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000)
    })
    this.ws.addEventListener('message', (e) => this.receive(String(e.data)))
    this.ws.addEventListener('close', () => {
      clearInterval(this.pinger)
      if (!this.ended) this.onStatus({ kind: 'error', reason: 'Koneksi ke server putus.' })
    })
    onStatus({ kind: 'connecting' })
  }

  private send(msg: object): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private receive(raw: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    const mirrored = this.slot === 1
    switch (msg.t) {
      case 'welcome':
        this.slot = msg.slot
        break
      case 'waiting':
        this.onStatus({ kind: 'waiting', code: this.code })
        break
      case 'start':
        this.names = this.slot === 1 ? [msg.names[1], msg.names[0]] : msg.names
        this.inbox = []
        this.onStatus({ kind: 'playing', names: this.names })
        break
      case 'snap':
        this.inbox.push(
          mirrored ? { state: mirrorState(msg.state), events: msg.events.map(mirrorEvent) } : { state: msg.state, events: msg.events },
        )
        break
      case 'rematch':
        this.onStatus({ kind: 'rematch', from: msg.from === this.slot ? 'me' : 'them' })
        break
      case 'left':
        this.ended = true
        this.onStatus({ kind: 'left' })
        break
      case 'full':
        this.ended = true
        this.onStatus({ kind: 'full' })
        break
      case 'error':
        this.ended = true
        this.onStatus({ kind: 'error', reason: msg.reason })
        break
      case 'pong':
        this.ping = Math.round(performance.now() - msg.at)
        break
      default:
        break
    }
  }

  /** Snapshots that arrived since the last call, oldest first. */
  drain(): Snapshot[] {
    const out = this.inbox
    this.inbox = []
    return out
  }

  /** Sends the local input when it changes, and every 250 ms regardless. */
  sendInput(local: Input, now: number): void {
    const input = this.slot === 1 ? mirrorInput(local) : local
    const same = this.lastSent && this.lastSent.pull === input.pull && this.lastSent.steer === input.steer
    if (same && now - this.lastSentAt < 250) return
    this.lastSent = input
    this.lastSentAt = now
    this.send({ t: 'input', pull: input.pull, steer: input.steer })
  }

  rematch(): void {
    this.send({ t: 'rematch' })
  }

  close(): void {
    this.ended = true
    clearInterval(this.pinger)
    this.ws.close()
  }
}

/** The random-matchmaking queue. Hands back a room code once paired. */
export class Matchmaker {
  private ws: WebSocket
  private done = false

  constructor(handlers: { queued: (waiting: number) => void; matched: (code: string) => void; failed: () => void }) {
    this.ws = new WebSocket(serverUrl('/ws/match'))
    this.ws.addEventListener('message', (e) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg
      } catch {
        return
      }
      if (msg.t === 'queued') handlers.queued(msg.waiting)
      if (msg.t === 'matched') {
        this.done = true
        this.ws.close()
        handlers.matched(msg.code)
      }
    })
    this.ws.addEventListener('close', () => {
      if (!this.done) handlers.failed()
    })
  }

  close(): void {
    this.done = true
    this.ws.close()
  }
}
