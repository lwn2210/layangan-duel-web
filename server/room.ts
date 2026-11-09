import { TICK_RATE } from '../src/sim/constants'
import { createMatch, IDLE, step, type Input, type MatchState, type SimEvent } from '../src/sim/match'
import { inputOf, parseClientMsg, PROTOCOL, SNAP_EVERY, type ServerMsg, type Slot } from '../src/net/protocol'

// One duel, authoritative: the room runs the sim on the wall clock, applies
// each player's latest Input and broadcasts snapshots. No sockets in here;
// the Node and Cloudflare adapters hand it Peers and call tick().

export interface Peer {
  send(data: string): void
  close(): void
}

interface Player {
  peer: Peer
  name: string
}

/** If the host stalls, catch up at most this many ticks at once, then skip. */
const MAX_CATCH_UP = 12

export class Room {
  private players: [Player | null, Player | null] = [null, null]
  private state: MatchState | null = null
  private inputs: [Input, Input] = [IDLE, IDLE]
  private pending: SimEvent[] = []
  private clock: { start: number; ticks: number } | null = null
  private rematch: [boolean, boolean] = [false, false]

  constructor(
    readonly code: string,
    private readonly now: () => number = Date.now,
    private readonly seed: () => number = () => (Math.random() * 2 ** 32) >>> 0,
  ) {}

  get empty(): boolean {
    return !this.players[0] && !this.players[1]
  }

  /** True while a match is being simulated. */
  get running(): boolean {
    return this.clock !== null
  }

  private slotOf(peer: Peer): Slot | null {
    if (this.players[0]?.peer === peer) return 0
    if (this.players[1]?.peer === peer) return 1
    return null
  }

  private send(peer: Peer, msg: ServerMsg): void {
    peer.send(JSON.stringify(msg))
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg)
    for (const p of this.players) p?.peer.send(data)
  }

  message(peer: Peer, raw: string): void {
    const msg = parseClientMsg(raw)
    if (!msg) return
    const slot = this.slotOf(peer)
    if (msg.t === 'hello') {
      if (slot === null) this.join(peer, msg.name, msg.v)
      return
    }
    if (slot === null) return
    switch (msg.t) {
      case 'input':
        this.inputs[slot] = inputOf(msg)
        break
      case 'ping':
        this.send(peer, { t: 'pong', at: msg.at })
        break
      case 'rematch':
        if (this.state?.phase !== 'matchOver' || !this.players[0] || !this.players[1]) return
        this.rematch[slot] = true
        this.broadcast({ t: 'rematch', from: slot })
        if (this.rematch[0] && this.rematch[1]) this.start()
        break
    }
  }

  private join(peer: Peer, name: string, version: number): void {
    if (version !== PROTOCOL) {
      this.send(peer, { t: 'error', reason: 'Versi game beda, coba muat ulang halaman.' })
      peer.close()
      return
    }
    const slot: Slot | null = !this.players[0] ? 0 : !this.players[1] ? 1 : null
    if (slot === null) {
      this.send(peer, { t: 'full' })
      peer.close()
      return
    }
    this.players[slot] = { peer, name }
    this.send(peer, { t: 'welcome', slot, code: this.code })
    if (this.players[0] && this.players[1]) this.start()
    else this.send(peer, { t: 'waiting' })
  }

  leave(peer: Peer): void {
    const slot = this.slotOf(peer)
    if (slot === null) return
    this.players[slot] = null
    this.state = null
    this.clock = null
    this.rematch = [false, false]
    const other = this.players[slot === 0 ? 1 : 0]
    if (other) this.send(other.peer, { t: 'left' })
  }

  private start(): void {
    const [a, b] = this.players
    if (!a || !b) return
    this.state = createMatch(this.seed())
    this.inputs = [IDLE, IDLE]
    this.pending = []
    this.rematch = [false, false]
    this.clock = { start: this.now(), ticks: 0 }
    this.broadcast({ t: 'start', names: [a.name, b.name] })
    this.broadcast({ t: 'snap', state: this.state, events: [] })
  }

  /** Runs the sim up to the current time. Call it at least 60 times a second. */
  tick(): void {
    const state = this.state
    const clock = this.clock
    if (!state || !clock) return
    const due = Math.floor(((this.now() - clock.start) / 1000) * TICK_RATE)
    if (due - clock.ticks > MAX_CATCH_UP) clock.ticks = due - MAX_CATCH_UP
    while (clock.ticks < due) {
      clock.ticks++
      this.pending.push(...step(state, this.inputs))
      const over = state.phase === 'matchOver'
      if (clock.ticks % SNAP_EVERY === 0 || over) {
        this.broadcast({ t: 'snap', state, events: this.pending })
        this.pending = []
      }
      if (over) {
        // Hold the final state until both ask for a rematch.
        this.clock = null
        return
      }
    }
  }
}
