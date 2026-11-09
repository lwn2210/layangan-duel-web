import { describe, expect, it } from 'vitest'
import { Lobby } from '../server/lobby'
import { Room, type Peer } from '../server/room'
import { mirrorEvent, mirrorInput, mirrorState } from '../src/net/mirror'
import { normaliseRoomCode, parseClientMsg, PROTOCOL, randomRoomCode, type ServerMsg } from '../src/net/protocol'
import { COUNTDOWN_TICKS } from '../src/sim/constants'
import { segmentIntersection } from '../src/sim/geometry'
import { ANCHORS } from '../src/sim/layout'
import { createMatch, step, type SimEvent } from '../src/sim/match'

class FakePeer implements Peer {
  inbox: ServerMsg[] = []
  closed = false
  send(data: string): void {
    this.inbox.push(JSON.parse(data) as ServerMsg)
  }
  close(): void {
    this.closed = true
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined
  }
  count(t: ServerMsg['t']): number {
    return this.inbox.filter((m) => m.t === t).length
  }
}

const hello = (name: string) => JSON.stringify({ t: 'hello', v: PROTOCOL, name })

function roomWithClock() {
  let now = 0
  const room = new Room('ABCDE', () => now, () => 7)
  return {
    room,
    advance(ms: number) {
      // Tick the way the adapters do: often, on the wall clock.
      for (let t = 0; t < ms; t += 8) {
        now += 8
        room.tick()
      }
    },
  }
}

describe('protocol', () => {
  it('makes and validates room codes', () => {
    const code = randomRoomCode()
    expect(normaliseRoomCode(code.toLowerCase())).toBe(code)
    expect(normaliseRoomCode('AB0DE')).toBeNull()
    expect(normaliseRoomCode('ABCD')).toBeNull()
  })

  it('accepts only well-formed client messages', () => {
    expect(parseClientMsg('{"t":"input","pull":true,"steer":1}')).toEqual({ t: 'input', pull: true, steer: 1 })
    expect(parseClientMsg('{"t":"input","pull":"yes","steer":1}')).toBeNull()
    expect(parseClientMsg('{"t":"input","pull":true,"steer":2}')).toBeNull()
    expect(parseClientMsg('not json')).toBeNull()
    expect(parseClientMsg(JSON.stringify({ t: 'hello', v: 1, name: '<b>Ucup</b>!!' }))).toEqual({ t: 'hello', v: 1, name: 'bUcupb' })
  })
})

describe('room', () => {
  it('seats two players, starts the match and streams snapshots', () => {
    const { room, advance } = roomWithClock()
    const a = new FakePeer()
    const b = new FakePeer()
    room.message(a, hello('Ucup'))
    expect(a.last('welcome')).toEqual({ t: 'welcome', slot: 0, code: 'ABCDE' })
    expect(a.last('waiting')).toBeTruthy()
    room.message(b, hello('Rina'))
    expect(b.last('welcome')?.slot).toBe(1)
    expect(a.last('start')?.names).toEqual(['Ucup', 'Rina'])
    advance(1000)
    // 60 ticks, a snapshot every 2, plus the one sent at the start.
    expect(a.count('snap')).toBeGreaterThanOrEqual(30)
    expect(b.last('snap')?.state.tick).toBe(a.last('snap')?.state.tick)
  })

  it('applies each player’s input to their own kite', () => {
    const { room, advance } = roomWithClock()
    const a = new FakePeer()
    const b = new FakePeer()
    room.message(a, hello('A'))
    room.message(b, hello('B'))
    advance((COUNTDOWN_TICKS / 60) * 1000 + 50)
    room.message(a, JSON.stringify({ t: 'input', pull: true, steer: 0 }))
    advance(1000)
    const [k0, k1] = a.last('snap')!.state.kites
    expect(k0.pulling).toBe(true)
    expect(k1.pulling).toBe(false)
    expect(k0.y).toBeGreaterThan(k1.y)
  })

  it('matches the sim run locally with the same seed and inputs', () => {
    const { room, advance } = roomWithClock()
    const a = new FakePeer()
    const b = new FakePeer()
    room.message(a, hello('A'))
    room.message(b, hello('B'))
    advance(2000)
    const local = createMatch(7)
    const tick = a.last('snap')!.state.tick
    for (let i = 0; i < tick; i++) step(local, [{ pull: false, steer: 0 }, { pull: false, steer: 0 }])
    expect(a.last('snap')!.state).toEqual(local)
  })

  it('turns a third player away', () => {
    const { room } = roomWithClock()
    const [a, b, c] = [new FakePeer(), new FakePeer(), new FakePeer()]
    room.message(a, hello('A'))
    room.message(b, hello('B'))
    room.message(c, hello('C'))
    expect(c.last('full')).toBeTruthy()
    expect(c.closed).toBe(true)
  })

  it('rejects an old client', () => {
    const { room } = roomWithClock()
    const a = new FakePeer()
    room.message(a, JSON.stringify({ t: 'hello', v: PROTOCOL + 1, name: 'A' }))
    expect(a.last('error')).toBeTruthy()
    expect(room.empty).toBe(true)
  })

  it('tells the other player when someone leaves, and stops', () => {
    const { room, advance } = roomWithClock()
    const a = new FakePeer()
    const b = new FakePeer()
    room.message(a, hello('A'))
    room.message(b, hello('B'))
    advance(500)
    room.leave(b)
    expect(a.last('left')).toBeTruthy()
    expect(room.running).toBe(false)
    const snaps = a.count('snap')
    advance(500)
    expect(a.count('snap')).toBe(snaps)
  })

  it('starts a rematch once both ask', () => {
    const { room, advance } = roomWithClock()
    const a = new FakePeer()
    const b = new FakePeer()
    room.message(a, hello('A'))
    room.message(b, hello('B'))
    // Neither pulls, so both crash every round; draws until someone... just run until it ends.
    for (let i = 0; i < 600 && room.running; i++) {
      room.message(a, JSON.stringify({ t: 'input', pull: true, steer: 0 }))
      advance(1000)
    }
    expect(room.running).toBe(false)
    expect(a.last('snap')!.state.phase).toBe('matchOver')
    room.message(a, JSON.stringify({ t: 'rematch' }))
    expect(b.last('rematch')?.from).toBe(0)
    expect(room.running).toBe(false)
    room.message(b, JSON.stringify({ t: 'rematch' }))
    expect(room.running).toBe(true)
    expect(a.last('snap')!.state.tick).toBe(0)
  })
})

describe('lobby', () => {
  it('pairs players first come, first served', () => {
    const lobby = new Lobby(() => 'PAIRS')
    const [a, b, c] = [new FakePeer(), new FakePeer(), new FakePeer()]
    lobby.join(a)
    expect(a.last('queued')?.waiting).toBe(1)
    lobby.join(b)
    expect(a.last('matched')?.code).toBe('PAIRS')
    expect(b.last('matched')?.code).toBe('PAIRS')
    lobby.join(c)
    expect(c.last('matched')).toBeUndefined()
    expect(lobby.waiting).toBe(1)
    lobby.leave(c)
    expect(lobby.waiting).toBe(0)
  })
})

describe('mirror', () => {
  const crossedState = () => {
    const s = createMatch(3)
    s.kites[0].x = 18
    s.kites[1].x = -12
    s.kites[1].y = 40
    s.scores = [2, 1]
    return s
  }

  it('is its own inverse', () => {
    const s = crossedState()
    expect(mirrorState(mirrorState(s))).toEqual(s)
  })

  it('keeps line crossings where they are, mirrored', () => {
    const s = crossedState()
    const m = mirrorState(s)
    const a = segmentIntersection(ANCHORS[0], s.kites[0], ANCHORS[1], s.kites[1])
    const b = segmentIntersection(ANCHORS[0], m.kites[0], ANCHORS[1], m.kites[1])
    expect(a).not.toBeNull()
    expect(b?.x).toBeCloseTo(-a!.x)
    expect(b?.y).toBeCloseTo(a!.y)
    expect(m.scores).toEqual([1, 2])
  })

  it('swaps who an event is about, and the steering', () => {
    const cut: SimEvent = { type: 'cut', player: 1, x: 5, y: 20 }
    expect(mirrorEvent(cut)).toEqual({ type: 'cut', player: 0, x: -5, y: 20 })
    expect(mirrorInput({ pull: true, steer: 1 })).toEqual({ pull: true, steer: -1 })
  })

  it('a mirrored player flies the same as an unmirrored one', () => {
    // Slot 1 steering "left" on its mirrored screen must turn its kite left on that screen.
    const s = createMatch(4)
    while (s.phase === 'countdown') step(s, [{ pull: false, steer: 0 }, { pull: false, steer: 0 }])
    const seen = () => mirrorState(s).kites[0]
    const before = seen().heading
    for (let i = 0; i < 30; i++) step(s, [{ pull: false, steer: 0 }, mirrorInput({ pull: true, steer: 1 })])
    expect(seen().heading).toBeGreaterThan(before)
  })
})
