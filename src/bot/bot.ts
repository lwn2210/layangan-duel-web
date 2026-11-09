import { MAX_SLACK } from '../sim/constants'
import { wrapAngle } from '../sim/geometry'
import { ANCHORS, type Vec2 } from '../sim/layout'
import { IDLE, type Input, type MatchState } from '../sim/match'
import { createRng, type Rng } from '../sim/rng'

// The computer opponent. It only produces Inputs, exactly like a player, so
// the sim cannot tell it apart from a person and it never cheats.

export type BotLevel = 'mudah' | 'sedang' | 'jago'

interface Profile {
  /** Ticks between decisions. */
  reaction: number
  /** How closely the nose must point at the target before it pulls, radians. */
  aim: number
  /** Chance per decision of fumbling a line fight. */
  fumble: number
  /** Chance per decision of hunting the opponent's line instead of cruising. */
  aggression: number
}

const PROFILES: Record<BotLevel, Profile> = {
  mudah: { reaction: 16, aim: 0.55, fumble: 0.6, aggression: 0.4 },
  sedang: { reaction: 8, aim: 0.34, fumble: 0.18, aggression: 0.75 },
  jago: { reaction: 4, aim: 0.22, fumble: 0.03, aggression: 0.95 },
}

const SAFE_Y = 14
const LOW_Y = 9
/** Each round opens with the bot getting its kite up before it hunts. */
const WARMUP_TICKS = 5 * 60

export class Bot {
  private readonly profile: Profile
  private readonly rng: Rng
  private nextThink = 0
  private held: Input = IDLE
  private hunting = true
  private cruise: Vec2 = { x: 0, y: 35 }

  constructor(
    readonly me: 0 | 1,
    level: BotLevel,
    seed: number,
  ) {
    this.profile = PROFILES[level]
    this.rng = createRng(seed)
  }

  think(state: MatchState): Input {
    const k = state.kites[this.me]
    if (state.phase !== 'fight' || k.status !== 'flying') {
      this.nextThink = 0
      // Between rounds a winner keeps its kite up.
      return state.phase === 'roundOver' && k.status === 'flying' ? this.fly(k, { x: k.x, y: 40 }) : IDLE
    }
    if (state.tick < this.nextThink) return this.held
    this.nextThink = state.tick + this.profile.reaction + Math.floor(this.rng() * 4)
    this.held = this.decide(state)
    return this.held
  }

  private decide(state: MatchState): Input {
    const k = state.kites[this.me]
    const o = state.kites[this.me === 0 ? 1 : 0]

    if (state.contact.active) {
      // A fumbling bot keeps paying out after the reel is spent, so its line
      // sits still in the contact.
      if (this.rng() < this.profile.fumble) return { pull: false, steer: 0 }
      // Keep line moving through the contact: pay out until the slack is
      // nearly used, then snatch it all back in.
      if (k.slack < MAX_SLACK - 4 && k.y > SAFE_Y) return { pull: false, steer: 0 }
      return this.fly(k, { x: k.x, y: k.y + 20 })
    }

    if (k.y < SAFE_Y) return this.fly(k, { x: k.x * 0.8, y: k.y + 25 })
    if (state.phaseTick < WARMUP_TICKS) return this.fly(k, { x: this.me === 0 ? -20 : 20, y: 44 })

    if (this.rng() < 0.1) this.hunting = this.rng() < this.profile.aggression
    if (this.hunting && o.status === 'flying') return this.fly(k, this.crossingPoint(o, this.me === 0 ? 1 : 0))

    if (Math.hypot(this.cruise.x - k.x, this.cruise.y - k.y) < 6 || this.rng() < 0.02) {
      this.cruise = { x: (this.rng() - 0.5) * 60, y: 22 + this.rng() * 30 }
    }
    return this.fly(k, this.cruise)
  }

  /**
   * A point just across the opponent's line from our own anchor: getting the
   * kite there drags our line over theirs.
   */
  private crossingPoint(o: MatchState['kites'][number], them: 0 | 1): Vec2 {
    const a = ANCHORS[them]
    const mine = ANCHORS[this.me]
    const dx = o.x - a.x
    const dy = o.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const along = { x: a.x + dx * 0.65, y: a.y + dy * 0.65 }
    const side = Math.sign(dx * (mine.y - a.y) - dy * (mine.x - a.x)) || 1
    // Unit normal pointing away from our anchor's side of their line.
    const nx = (dy / len) * side
    const ny = (-dx / len) * side
    return { x: along.x + nx * 9, y: Math.max(SAFE_Y + 4, along.y + ny * 9) }
  }

  /** Point the nose at `target` while released, pull once it is lined up. */
  private fly(k: MatchState['kites'][number], target: Vec2): Input {
    const desired = Math.atan2(target.y - k.y, target.x - k.x)
    const error = wrapAngle(desired - k.heading)
    const steer: -1 | 0 | 1 = Math.abs(error) < 0.08 ? 0 : error > 0 ? 1 : -1
    const aligned = Math.abs(error) < this.profile.aim + (this.rng() - 0.5) * 0.1
    if (aligned || (k.y < LOW_Y && Math.abs(error) < 1.2)) return { pull: true, steer }
    return { pull: false, steer }
  }
}
