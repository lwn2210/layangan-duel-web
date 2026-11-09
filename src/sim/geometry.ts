import type { Vec2 } from './layout'

/** Where segments a→b and c→d cross, or null if they don't. Parallel segments never count. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): (Vec2 & { t: number; u: number }) | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null
  const qx = c.x - a.x
  const qy = c.y - a.y
  const t = (qx * sy - qy * sx) / denom
  const u = (qx * ry - qy * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a.x + t * rx, y: a.y + t * ry, t, u }
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2
  let r = a % twoPi
  if (r <= -Math.PI) r += twoPi
  else if (r > Math.PI) r -= twoPi
  return r
}
