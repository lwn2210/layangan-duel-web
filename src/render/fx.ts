import * as THREE from 'three'
import { PLANE_Z } from '../sim/layout'
import { canvasTexture } from './textures'

// Glints where the glass-coated lines grind, and a burst when one parts.

const MAX = 160

export class Sparks {
  private readonly points: THREE.Points
  private readonly pos = new Float32Array(MAX * 3)
  private readonly vel = new Float32Array(MAX * 3)
  private readonly life = new Float32Array(MAX)
  private readonly glow: THREE.Sprite
  private cursor = 0

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    const dot = canvasTexture('spark', 64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.3, 'rgba(255,225,150,0.9)')
      g.addColorStop(1, 'rgba(255,180,80,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ map: dot, size: 1.1, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    )
    this.points.frustumCulled = false
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    this.glow.visible = false
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -1000
    scene.add(this.points, this.glow)
  }

  private emit(x: number, y: number, speed: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % MAX
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.4 + Math.random() * 0.6)
    this.pos.set([x, y, PLANE_Z + 1], i * 3)
    this.vel.set([Math.cos(a) * s, Math.sin(a) * s, 0], i * 3)
    this.life[i] = 0.35 + Math.random() * 0.35
  }

  burst(x: number, y: number): void {
    for (let i = 0; i < 50; i++) this.emit(x, y, 14)
  }

  update(dt: number, contact: { active: boolean; x: number; y: number } | null, time: number): void {
    if (contact?.active) {
      for (let i = 0; i < 3; i++) this.emit(contact.x, contact.y, 6)
      this.glow.visible = true
      this.glow.position.set(contact.x, contact.y, PLANE_Z + 1)
      this.glow.scale.setScalar(3 + Math.sin(time * 40) * 0.8)
    } else {
      this.glow.visible = false
    }
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) continue
      this.life[i]! -= dt
      if (this.life[i]! <= 0) {
        this.pos[i * 3 + 1] = -1000
        continue
      }
      this.vel[i * 3 + 1]! -= 18 * dt
      this.pos[i * 3]! += this.vel[i * 3]! * dt
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt
    }
    this.points.geometry.attributes.position!.needsUpdate = true
  }
}
