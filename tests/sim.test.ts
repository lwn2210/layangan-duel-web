import { describe, expect, it } from 'vitest'
import { Bot } from '../src/bot/bot'
import { COUNTDOWN_TICKS, GROUND_Y, LINE_HP } from '../src/sim/constants'
import { segmentIntersection, wrapAngle } from '../src/sim/geometry'
import { ANCHORS, CAMERA, HANDS, PLANE_Z, projectToPlane } from '../src/sim/layout'
import { createMatch, IDLE, step, type Input, type MatchState, type SimEvent } from '../src/sim/match'

const PULL: Input = { pull: true, steer: 0 }

function toFight(state: MatchState): void {
  while (state.phase === 'countdown') step(state, [IDLE, IDLE])
}

function run(state: MatchState, ticks: number, inputs: (s: MatchState) => [Input, Input]): SimEvent[] {
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) events.push(...step(state, inputs(state)))
  return events
}

describe('geometry', () => {
  it('finds a crossing and rejects near misses', () => {
    const hit = segmentIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })
    expect(hit).toMatchObject({ x: 1, y: 1 })
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: -1 })).toBeNull()
    expect(segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull()
  })

  it('wraps angles', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2)
  })

  it('projects the hands onto the kite plane along camera rays', () => {
    for (const hand of HANDS) {
      const p = projectToPlane(hand)
      // Camera, hand and its projection are collinear.
      const t = (hand.z - CAMERA.z) / (PLANE_Z - CAMERA.z)
      expect(CAMERA.x + (p.x - CAMERA.x) * t).toBeCloseTo(hand.x)
      expect(CAMERA.y + (p.y - CAMERA.y) * t).toBeCloseTo(hand.y)
    }
    expect(ANCHORS[0].x).toBeLessThan(-20)
    expect(ANCHORS[1].x).toBeGreaterThan(20)
  })
})

describe('flight', () => {
  it('holds still during the countdown', () => {
    const s = createMatch(1)
    const before = { ...s.kites[0] }
    run(s, COUNTDOWN_TICKS - 1, () => [PULL, PULL])
    expect(s.kites[0].x).toBe(before.x)
    expect(s.phase).toBe('countdown')
  })

  it('pulling with the nose up climbs; releasing sinks, spins and pays out line', () => {
    const s = createMatch(1)
    toFight(s)
    const y0 = s.kites[0].y
    run(s, 60, () => [PULL, IDLE])
    expect(s.kites[0].y).toBeGreaterThan(y0 + 5)

    const k = s.kites[0]
    const y1 = k.y
    const heading = k.heading
    // A short glide on the leftover speed, then it sinks.
    run(s, 180, () => [IDLE, IDLE])
    expect(k.y).toBeLessThan(y1)
    expect(k.heading).not.toBeCloseTo(heading)
    expect(k.slack).toBeGreaterThan(4)
  })

  it('pulling takes the slack back in', () => {
    const s = createMatch(1)
    toFight(s)
    run(s, 120, () => [IDLE, IDLE])
    expect(s.kites[0].slack).toBeGreaterThan(10)
    run(s, 120, () => [PULL, PULL])
    expect(s.kites[0].slack).toBe(0)
  })

  it('a kite left to sink gets caught in the roofs and loses the round', () => {
    const s = createMatch(1)
    toFight(s)
    const events: SimEvent[] = []
    for (let i = 0; i < 60 * 20 && s.phase === 'fight'; i++) events.push(...step(s, [IDLE, PULL]))
    expect(events).toContainEqual({ type: 'crash', player: 0 })
    expect(s.kites[0].y).toBeLessThan(GROUND_Y)
    expect(s.lastResult?.winner).toBe(1)
    expect(s.scores).toEqual([0, 1])
  })

  it('is deterministic', () => {
    const script = (s: MatchState): [Input, Input] => {
      const t = s.tick
      return [
        { pull: t % 90 < 50, steer: t % 200 < 100 ? 1 : -1 },
        { pull: t % 70 < 45, steer: t % 150 < 60 ? -1 : 0 },
      ]
    }
    const a = createMatch(42)
    const b = createMatch(42)
    run(a, 3000, script)
    run(b, 3000, script)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('line fights', () => {
  /** Places the kites so their lines cross, and freezes them there. */
  function crossed(): MatchState {
    const s = createMatch(5)
    toFight(s)
    s.kites[0].x = 20
    s.kites[0].y = 30
    s.kites[1].x = -20
    s.kites[1].y = 30
    return s
  }

  it('the line held still is the one that parts', () => {
    const s = crossed()
    const events: SimEvent[] = []
    for (let i = 0; i < 600 && s.phase === 'fight'; i++) {
      // Player 0 pays out line; player 1 keeps it taut and still.
      s.kites[1].x = -20
      s.kites[1].y = 30
      s.kites[1].vx = s.kites[1].vy = 0
      s.kites[0].y = Math.max(s.kites[0].y, 25)
      events.push(...step(s, [IDLE, { pull: true, steer: 0 }]))
    }
    expect(events.find((e) => e.type === 'contactStart')).toBeTruthy()
    expect(events).toContainEqual(expect.objectContaining({ type: 'cut', player: 1 }))
    expect(s.kites[0].hp).toBeGreaterThan(LINE_HP * 0.5)
    expect(s.lastResult).toEqual({ winner: 0, reason: 'cut' })
  })

  it('no contact, no wear', () => {
    const s = createMatch(5)
    toFight(s)
    run(s, 30, () => [PULL, PULL])
    expect(s.contact.active).toBe(false)
    expect(s.kites[0].hp).toBe(LINE_HP)
  })
})

describe('match flow', () => {
  it('first to three rounds wins the match', () => {
    const s = createMatch(9)
    const events: SimEvent[] = []
    // Player 1 never pulls, so it crashes every round.
    for (let i = 0; i < 60 * 200 && s.phase !== 'matchOver'; i++) events.push(...step(s, [PULL, IDLE]))
    expect(s.scores[0]).toBe(3)
    expect(events).toContainEqual({ type: 'matchOver', winner: 0 })
  })
})

describe('bot', () => {
  it('keeps its kite in the air', () => {
    for (const level of ['mudah', 'sedang', 'jago'] as const) {
      const s = createMatch(11)
      const bot = new Bot(1, level, 3)
      toFight(s)
      // Opponent climbs out of the way and stays high.
      run(s, 60 * 25, (st) => [{ pull: st.kites[0].y < 50, steer: 0 }, bot.think(st)])
      expect(s.kites[1].status, level).toBe('flying')
    }
  })

  it('two bots finish a match', () => {
    const s = createMatch(21)
    const a = new Bot(0, 'sedang', 1)
    const b = new Bot(1, 'jago', 2)
    const events: SimEvent[] = []
    for (let i = 0; i < 60 * 60 * 10 && s.phase !== 'matchOver'; i++) events.push(...step(s, [a.think(s), b.think(s)]))
    expect(s.phase).toBe('matchOver')
    const reasons = events.filter((e) => e.type === 'roundOver').map((e) => (e.type === 'roundOver' ? e.result.reason : ''))
    // Bots should mostly settle rounds by cutting, not by flying into the roofs.
    expect(reasons.filter((r) => r === 'cut').length).toBeGreaterThan(0)
  })
})
