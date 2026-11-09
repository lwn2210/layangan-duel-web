import { randomRoomCode, type ServerMsg } from '../src/net/protocol'
import type { Peer } from './room'

// Random matchmaking: players wait in one queue and are paired first come,
// first served. A pair gets a fresh room code and then joins that room like
// friends would.

export class Lobby {
  private queue: Peer[] = []

  constructor(private readonly makeCode: () => string = () => randomRoomCode()) {}

  get waiting(): number {
    return this.queue.length
  }

  private send(peer: Peer, msg: ServerMsg): void {
    peer.send(JSON.stringify(msg))
  }

  join(peer: Peer): void {
    if (this.queue.includes(peer)) return
    this.queue.push(peer)
    while (this.queue.length >= 2) {
      const a = this.queue.shift()!
      const b = this.queue.shift()!
      const code = this.makeCode()
      this.send(a, { t: 'matched', code })
      this.send(b, { t: 'matched', code })
    }
    this.announce()
  }

  leave(peer: Peer): void {
    const i = this.queue.indexOf(peer)
    if (i < 0) return
    this.queue.splice(i, 1)
    this.announce()
  }

  private announce(): void {
    for (const p of this.queue) this.send(p, { t: 'queued', waiting: this.queue.length })
  }
}
