import type { Input, Kite, MatchState, SimEvent } from '../sim/match'

// The player on the right (slot 1) sees the field mirrored, so everyone plays
// from the left with the red kite. The layout is symmetric about x = 0 and a
// mirror keeps lines straight, so lines cross on screen exactly as in the sim.

function mirrorKite(k: Kite): Kite {
  return {
    ...k,
    x: -k.x,
    vx: -k.vx,
    heading: Math.PI - k.heading,
    spinDir: k.spinDir === 1 ? -1 : 1,
    cutAt: k.cutAt ? { x: -k.cutAt.x, y: k.cutAt.y } : null,
  }
}

const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0)
const otherOrDraw = (p: -1 | 0 | 1): -1 | 0 | 1 => (p === -1 ? -1 : other(p))

/** The match as slot 1 sees it: sides swapped, x flipped. */
export function mirrorState(s: MatchState): MatchState {
  return {
    ...s,
    scores: [s.scores[1], s.scores[0]],
    kites: [mirrorKite(s.kites[1]), mirrorKite(s.kites[0])],
    contact: { ...s.contact, x: -s.contact.x },
    lastResult: s.lastResult ? { ...s.lastResult, winner: otherOrDraw(s.lastResult.winner) } : null,
  }
}

export function mirrorEvent(e: SimEvent): SimEvent {
  switch (e.type) {
    case 'contactStart':
      return { ...e, x: -e.x }
    case 'cut':
      return { ...e, player: other(e.player), x: -e.x }
    case 'crash':
      return { ...e, player: other(e.player) }
    case 'roundOver':
      return { ...e, result: { ...e.result, winner: otherOrDraw(e.result.winner) } }
    case 'matchOver':
      return { ...e, winner: other(e.winner) }
    default:
      return e
  }
}

/** Turning left on a mirrored screen is turning right in the sim. */
export function mirrorInput(input: Input): Input {
  return { pull: input.pull, steer: input.steer === 0 ? 0 : input.steer === 1 ? -1 : 1 }
}
