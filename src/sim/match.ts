import {
  BOUNDS,
  COUNTDOWN_TICKS,
  DT,
  FLY_SPEED,
  GROUND_Y,
  IDLE_SPIN,
  LINE_HP,
  MAX_RANGE,
  MAX_SLACK,
  PULL_RESPONSE,
  PULL_SINK,
  PULL_TURN,
  REEL_IN,
  REEL_OUT,
  ROUND_OVER_TICKS,
  ROUND_TICKS,
  ROUNDS_TO_WIN,
  SAW,
  SAW_BASE,
  SAW_PROTECT,
  SLACK_RESPONSE,
  SLACK_SINK,
  SLACK_THRUST,
  START_POS,
  STEER_SPIN,
} from './constants'
import { segmentIntersection } from './geometry'
import { ANCHORS, type Vec2 } from './layout'
import { createRng } from './rng'

// The whole duel as plain data and one step function. No DOM, no clocks, no
// Math.random: the same seed and inputs always give the same match, and the
// state serialises as JSON, so it can run in a browser, a bot test or a
// server room unchanged.

export interface Input {
  /** Held: tarik. Released: ulur. */
  pull: boolean
  /** +1 turns the nose counter-clockwise (left when pointing up), -1 clockwise. */
  steer: -1 | 0 | 1
}

export const IDLE: Input = { pull: false, steer: 0 }

export type KiteStatus = 'flying' | 'cut' | 'crashed'

export interface Kite {
  x: number
  y: number
  vx: number
  vy: number
  /** Nose direction, radians. π/2 points straight up. */
  heading: number
  spinDir: 1 | -1
  /** Line paid out beyond the straight distance to the kite. */
  slack: number
  lineLength: number
  /** How fast line is moving through the player's hand, m/s. */
  lineSpeed: number
  hp: number
  pulling: boolean
  status: KiteStatus
  /** Where the line parted, for the renderer. */
  cutAt: Vec2 | null
}

export type Phase = 'countdown' | 'fight' | 'roundOver' | 'matchOver'
export type EndReason = 'cut' | 'crash' | 'time'

export interface RoundResult {
  /** 0 or 1, or -1 for a draw. */
  winner: -1 | 0 | 1
  reason: EndReason
}

export interface MatchState {
  tick: number
  phase: Phase
  phaseTick: number
  round: number
  scores: [number, number]
  kites: [Kite, Kite]
  contact: { active: boolean; x: number; y: number; ticks: number }
  wind: [number, number, number, number]
  lastResult: RoundResult | null
}

export type SimEvent =
  | { type: 'countdown'; round: number }
  | { type: 'fight' }
  | { type: 'contactStart'; x: number; y: number }
  | { type: 'contactEnd' }
  | { type: 'cut'; player: 0 | 1; x: number; y: number }
  | { type: 'crash'; player: 0 | 1 }
  | { type: 'roundOver'; result: RoundResult }
  | { type: 'matchOver'; winner: 0 | 1 }

function freshKite(i: 0 | 1): Kite {
  const start = START_POS[i]
  const anchor = ANCHORS[i]
  const dist = Math.hypot(start.x - anchor.x, start.y - anchor.y)
  return {
    x: start.x,
    y: start.y,
    vx: 0,
    vy: 0,
    heading: Math.PI / 2,
    spinDir: i === 0 ? -1 : 1,
    slack: 0,
    lineLength: dist,
    lineSpeed: 0,
    hp: LINE_HP,
    pulling: false,
    status: 'flying',
    cutAt: null,
  }
}

export function createMatch(seed: number): MatchState {
  const rng = createRng(seed)
  const phase = () => rng() * Math.PI * 2
  return {
    tick: 0,
    phase: 'countdown',
    phaseTick: 0,
    round: 1,
    scores: [0, 0],
    kites: [freshKite(0), freshKite(1)],
    contact: { active: false, x: 0, y: 0, ticks: 0 },
    wind: [phase(), phase(), phase(), phase()],
    lastResult: null,
  }
}

export interface Wind {
  /** Multiplies flying speed. */
  power: number
  /** Sideways drift, m/s. */
  drift: number
}

export function windAt(state: MatchState): Wind {
  const t = state.tick * DT
  const [a, b, c, d] = state.wind
  return {
    power: 1 + 0.15 * Math.sin(0.23 * t + a) + 0.06 * Math.sin(0.71 * t + b),
    drift: 1.4 * Math.sin(0.11 * t + c) + 0.5 * Math.sin(0.47 * t + d),
  }
}

function blend(current: number, target: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * DT))
}

function flyKite(k: Kite, anchor: Vec2, input: Input, wind: Wind): void {
  k.pulling = input.pull
  if (input.pull) {
    k.heading += input.steer * PULL_TURN * DT
    const thrust = FLY_SPEED * wind.power * (k.slack > 0.5 ? SLACK_THRUST : 1)
    k.vx = blend(k.vx, Math.cos(k.heading) * thrust + wind.drift, PULL_RESPONSE)
    k.vy = blend(k.vy, Math.sin(k.heading) * thrust - PULL_SINK, PULL_RESPONSE)
  } else {
    if (input.steer !== 0) k.spinDir = input.steer
    k.heading += (input.steer !== 0 ? STEER_SPIN : IDLE_SPIN) * k.spinDir * DT
    k.vx = blend(k.vx, wind.drift * 1.5, SLACK_RESPONSE)
    k.vy = blend(k.vy, -SLACK_SINK, SLACK_RESPONSE)
  }
  k.heading %= Math.PI * 2

  k.x += k.vx * DT
  k.y += k.vy * DT
  if (k.x < BOUNDS.minX || k.x > BOUNDS.maxX) {
    k.x = Math.min(BOUNDS.maxX, Math.max(BOUNDS.minX, k.x))
    k.vx = 0
  }
  if (k.y > BOUNDS.ceiling) {
    k.y = BOUNDS.ceiling
    k.vy = Math.min(0, k.vy)
  }

  let dx = k.x - anchor.x
  let dy = k.y - anchor.y
  let dist = Math.hypot(dx, dy)
  if (dist > MAX_RANGE) {
    // Out of line: hold the kite on the circle and drop its outward speed.
    dx /= dist
    dy /= dist
    k.x = anchor.x + dx * MAX_RANGE
    k.y = anchor.y + dy * MAX_RANGE
    const outward = k.vx * dx + k.vy * dy
    if (outward > 0) {
      k.vx -= outward * dx
      k.vy -= outward * dy
    }
    dist = MAX_RANGE
  }

  const before = k.lineLength
  k.slack = input.pull ? Math.max(0, k.slack - REEL_IN * DT) : Math.min(MAX_SLACK, k.slack + REEL_OUT * DT)
  k.lineLength = dist + k.slack
  k.lineSpeed = Math.abs(k.lineLength - before) / DT
}

/** A parted kite flutters away downwind and down. */
function driftLoose(k: Kite, wind: Wind): void {
  k.heading += 5 * k.spinDir * DT
  k.vx = blend(k.vx, wind.drift + 2.5, 0.8)
  k.vy = blend(k.vy, -2.2, 0.8)
  k.x += k.vx * DT
  k.y = Math.max(GROUND_Y - 1, k.y + k.vy * DT)
}

function placeForRound(state: MatchState): void {
  state.kites = [freshKite(0), freshKite(1)]
  state.contact = { active: false, x: 0, y: 0, ticks: 0 }
}

function endRound(state: MatchState, result: RoundResult, events: SimEvent[]): void {
  state.phase = 'roundOver'
  state.phaseTick = 0
  state.lastResult = result
  if (result.winner !== -1) state.scores[result.winner]++
  if (state.contact.active) events.push({ type: 'contactEnd' })
  state.contact.active = false
  events.push({ type: 'roundOver', result })
}

function stepFight(state: MatchState, inputs: readonly [Input, Input], events: SimEvent[]): void {
  const wind = windAt(state)
  state.kites.forEach((k, i) => {
    if (k.status === 'flying') flyKite(k, ANCHORS[i as 0 | 1], inputs[i]!, wind)
    else if (k.status === 'cut') driftLoose(k, wind)
  })
  if (state.phase !== 'fight') {
    // Between rounds the survivor can show off but can no longer crash.
    for (const k of state.kites) if (k.status === 'flying') k.y = Math.max(GROUND_Y, k.y)
    return
  }

  const [k0, k1] = state.kites
  const crossing =
    k0.status === 'flying' && k1.status === 'flying' ? segmentIntersection(ANCHORS[0], k0, ANCHORS[1], k1) : null
  if (crossing) {
    if (!state.contact.active) events.push({ type: 'contactStart', x: crossing.x, y: crossing.y })
    state.contact.active = true
    state.contact.x = crossing.x
    state.contact.y = crossing.y
    state.contact.ticks++
    // The line moving through the contact spreads the wear along its length;
    // a line held still is sawn at one spot.
    const d0 = (SAW * (SAW_BASE + k1.lineSpeed)) / (1 + SAW_PROTECT * k0.lineSpeed)
    const d1 = (SAW * (SAW_BASE + k0.lineSpeed)) / (1 + SAW_PROTECT * k1.lineSpeed)
    k0.hp -= d0 * DT
    k1.hp -= d1 * DT
  } else if (state.contact.active) {
    state.contact.active = false
    state.contact.ticks = 0
    events.push({ type: 'contactEnd' })
  }

  const cut0 = k0.hp <= 0
  const cut1 = k1.hp <= 0
  if (cut0 || cut1) {
    // If both part on the same tick, the one with less left goes.
    const loser: 0 | 1 = cut0 && cut1 ? (k0.hp <= k1.hp ? 0 : 1) : cut0 ? 0 : 1
    const k = state.kites[loser]
    k.status = 'cut'
    k.hp = 0
    k.cutAt = { x: state.contact.x, y: state.contact.y }
    events.push({ type: 'cut', player: loser, x: state.contact.x, y: state.contact.y })
    endRound(state, { winner: loser === 0 ? 1 : 0, reason: 'cut' }, events)
    return
  }

  const down0 = k0.y < GROUND_Y
  const down1 = k1.y < GROUND_Y
  if (down0 || down1) {
    if (down0) {
      k0.status = 'crashed'
      events.push({ type: 'crash', player: 0 })
    }
    if (down1) {
      k1.status = 'crashed'
      events.push({ type: 'crash', player: 1 })
    }
    endRound(state, { winner: down0 && down1 ? -1 : down0 ? 1 : 0, reason: 'crash' }, events)
    return
  }

  if (state.phaseTick >= ROUND_TICKS) {
    const winner = k0.hp > k1.hp ? 0 : k1.hp > k0.hp ? 1 : -1
    endRound(state, { winner, reason: 'time' }, events)
  }
}

/** Advances the match one tick. Mutates `state`; returns what happened. */
export function step(state: MatchState, inputs: readonly [Input, Input]): SimEvent[] {
  const events: SimEvent[] = []
  state.tick++
  state.phaseTick++
  switch (state.phase) {
    case 'countdown':
      if (state.phaseTick === 1) events.push({ type: 'countdown', round: state.round })
      if (state.phaseTick >= COUNTDOWN_TICKS) {
        state.phase = 'fight'
        state.phaseTick = 0
        events.push({ type: 'fight' })
      }
      break
    case 'fight':
      stepFight(state, inputs, events)
      break
    case 'roundOver':
      stepFight(state, inputs, events)
      if (state.phaseTick >= ROUND_OVER_TICKS) {
        const champion = state.scores.findIndex((s) => s >= ROUNDS_TO_WIN)
        if (champion >= 0) {
          state.phase = 'matchOver'
          state.phaseTick = 0
          events.push({ type: 'matchOver', winner: champion as 0 | 1 })
        } else {
          state.round++
          state.phase = 'countdown'
          state.phaseTick = 0
          placeForRound(state)
        }
      }
      break
    case 'matchOver':
      break
  }
  return events
}
