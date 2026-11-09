// Shared between the sim and the renderer. The kites fly in a vertical plane
// at PLANE_Z; the lines run from each player's hand near the camera out to
// that plane. A central projection preserves straight lines and where they
// cross, so if the sim works with the hands *projected onto the plane from
// the camera*, two lines cross in the sim exactly when they cross on screen,
// whatever the camera's field of view or aim. Only the camera position counts,
// so it is fixed here and must be the same on every client.

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 extends Vec2 {
  z: number
}

export const CAMERA: Vec3 = { x: 0, y: 1.6, z: 8 }
export const PLANE_Z = -70
export const HANDS: readonly [Vec3, Vec3] = [
  { x: -3.5, y: 1.3, z: 0 },
  { x: 3.5, y: 1.3, z: 0 },
]

export function projectToPlane(p: Vec3): Vec2 {
  const f = (CAMERA.z - PLANE_Z) / (CAMERA.z - p.z)
  return { x: CAMERA.x + (p.x - CAMERA.x) * f, y: CAMERA.y + (p.y - CAMERA.y) * f }
}

/** Where each line starts, in plane coordinates. */
export const ANCHORS: readonly [Vec2, Vec2] = [projectToPlane(HANDS[0]), projectToPlane(HANDS[1])]
