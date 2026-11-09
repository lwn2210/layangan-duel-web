// Tuning for the duel. Plane coordinates are metres; one tick is 1/60 s.

export const TICK_RATE = 60
export const DT = 1 / TICK_RATE

export const BOUNDS = { minX: -46, maxX: 46, ceiling: 60 }
/** Below this height a kite is caught in the roofs and trees. */
export const GROUND_Y = 3
/** Longest a line can be. */
export const MAX_RANGE = 92

/** Pulling: the kite darts along its nose at this speed (times wind power). */
export const FLY_SPEED = 15
export const PULL_RESPONSE = 4
export const PULL_SINK = 0.6
export const PULL_TURN = 1.8
/** While there is still slack to take in, a pull only gives this much thrust. */
export const SLACK_THRUST = 0.35

/** Released: the kite spins slowly and sinks while line pays out. */
export const SLACK_RESPONSE = 2.5
export const SLACK_SINK = 2.6
export const IDLE_SPIN = 2.2
export const STEER_SPIN = 4

/** Line paid out per second while released. */
export const REEL_OUT = 6
/** Slack taken in per second while pulling. */
export const REEL_IN = 14
export const MAX_SLACK = 25

export const LINE_HP = 100
/** Damage per second while lines touch: SAW · (BASE + opponent line speed) / (1 + PROTECT · own line speed). */
export const SAW = 2.4
export const SAW_BASE = 1
export const SAW_PROTECT = 0.5

export const ROUNDS_TO_WIN = 3
export const COUNTDOWN_TICKS = 3 * TICK_RATE
export const ROUND_TICKS = 90 * TICK_RATE
export const ROUND_OVER_TICKS = Math.round(3.5 * TICK_RATE)

export const START_POS = [
  { x: -14, y: 30 },
  { x: 14, y: 30 },
] as const
