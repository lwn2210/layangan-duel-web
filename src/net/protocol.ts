import type { Input, MatchState, SimEvent } from '../sim/match'

// Messages between the game and the server, as JSON text frames. The server
// runs the sim; a client only ever sends its Input and renders snapshots.

export const PROTOCOL = 1

/** Server sends a snapshot every this many sim ticks (30 per second). */
export const SNAP_EVERY = 2

export const ROOM_CODE_LENGTH = 5
/** No 0/O, 1/I/L: codes get read out loud and typed on phones. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export type Slot = 0 | 1

export type ClientMsg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'input'; pull: boolean; steer: -1 | 0 | 1 }
  | { t: 'rematch' }
  | { t: 'ping'; at: number }

export type ServerMsg =
  | { t: 'welcome'; slot: Slot; code: string }
  | { t: 'full' }
  | { t: 'waiting' }
  | { t: 'start'; names: [string, string] }
  | { t: 'snap'; state: MatchState; events: SimEvent[] }
  | { t: 'left' }
  | { t: 'rematch'; from: Slot }
  | { t: 'pong'; at: number }
  | { t: 'queued'; waiting: number }
  | { t: 'matched'; code: string }
  | { t: 'error'; reason: string }

export function randomRoomCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return code
}

export function normaliseRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  if (code.length !== ROOM_CODE_LENGTH) return null
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null
  return code
}

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 16) : ''
  return name || 'Pemain'
}

/** Parses a client frame, or null if it is not one we accept. */
export function parseClientMsg(raw: string): ClientMsg | null {
  if (raw.length > 512) return null
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  switch (m.t) {
    case 'hello':
      return typeof m.v === 'number' ? { t: 'hello', v: m.v, name: cleanName(m.name) } : null
    case 'input':
      if (typeof m.pull !== 'boolean' || (m.steer !== -1 && m.steer !== 0 && m.steer !== 1)) return null
      return { t: 'input', pull: m.pull, steer: m.steer }
    case 'rematch':
      return { t: 'rematch' }
    case 'ping':
      return typeof m.at === 'number' ? { t: 'ping', at: m.at } : null
    default:
      return null
  }
}

export function inputOf(msg: Extract<ClientMsg, { t: 'input' }>): Input {
  return { pull: msg.pull, steer: msg.steer }
}
