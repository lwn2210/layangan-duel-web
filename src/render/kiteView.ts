import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { HANDS, PLANE_Z, type Vec2 } from '../sim/layout'
import type { Kite } from '../sim/match'
import { canvasTexture } from './textures'

// A diamond fighter kite (layangan aduan) and its line, drawn from sim state.

/** Kites are drawn larger than life so they read at 70 m. */
const KITE_SCALE = 3.4
const LINE_POINTS = 40

const DIAMOND = { top: 1.0, side: 0.72, shoulder: 0.18, bottom: -0.78 }

function kiteGeometry(): THREE.BufferGeometry {
  const { top, side, shoulder, bottom } = DIAMOND
  // Five points: the tips and a centre bowed back, so light falls across the sail.
  const pts = [
    [0, top, 0],
    [-side, shoulder, 0],
    [0, bottom, 0],
    [side, shoulder, 0],
    [0, 0.05, -0.12],
  ] as const
  const index = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]
  const position = new Float32Array(index.length * 3)
  const uv = new Float32Array(index.length * 2)
  index.forEach((v, i) => {
    const [x, y, z] = pts[v]!
    position.set([x, y, z], i * 3)
    uv.set([(x + side) / (side * 2), (y - bottom) / (top - bottom)], i * 2)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.computeVertexNormals()
  return geo
}

export interface KiteLook {
  key: string
  main: string
  accent: string
  line: string
}

export const LOOKS: readonly [KiteLook, KiteLook] = [
  { key: 'garuda-merah', main: '#d50000', accent: '#fffde7', line: '#ff5252' },
  { key: 'sukabumi-petir', main: '#0d47a1', accent: '#ffd600', line: '#00e5ff' },
]

function sailTexture(look: KiteLook): THREE.Texture {
  return canvasTexture(`kite-${look.key}`, 256, 256, (ctx, w, h) => {
    const { top, side, shoulder, bottom } = DIAMOND
    const px = (x: number) => ((x + side) / (side * 2)) * w
    const py = (y: number) => h - ((y - bottom) / (top - bottom)) * h

    // Base paper
    ctx.fillStyle = look.accent
    ctx.fillRect(0, 0, w, h)

    // Dynamic fighter kite wing pattern (Garuda/Petir Chevron)
    ctx.fillStyle = look.main
    ctx.beginPath()
    ctx.moveTo(px(0), py(top))
    ctx.lineTo(px(-side), py(shoulder))
    ctx.lineTo(px(-side * 0.4), py(shoulder - 0.2))
    ctx.lineTo(px(0), py(top * 0.3))
    ctx.lineTo(px(side * 0.4), py(shoulder - 0.2))
    ctx.lineTo(px(side), py(shoulder))
    ctx.closePath()
    ctx.fill()

    // Racing/Fighting stripes across the lower diamond
    ctx.fillStyle = look.main
    ctx.beginPath()
    ctx.moveTo(px(-side * 0.7), py(shoulder * 0.2))
    ctx.lineTo(px(0), py(bottom * 0.6))
    ctx.lineTo(px(side * 0.7), py(shoulder * 0.2))
    ctx.lineTo(px(side * 0.4), py(shoulder * 0.2 - 0.1))
    ctx.lineTo(px(0), py(bottom * 0.8))
    ctx.lineTo(px(-side * 0.4), py(shoulder * 0.2 - 0.1))
    ctx.closePath()
    ctx.fill()

    // Central emblem circle
    ctx.fillStyle = '#212121'
    ctx.beginPath()
    ctx.arc(px(0), py(shoulder * 0.5), w * 0.08, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = look.accent
    ctx.beginPath()
    ctx.arc(px(0), py(shoulder * 0.5), w * 0.045, 0, Math.PI * 2)
    ctx.fill()

    // Authentic Indonesian bamboo spine and bowed spar (bambu apus / tali)
    ctx.strokeStyle = '#8d5d28'
    ctx.lineWidth = 5.5
    ctx.lineCap = 'round'
    // Central upright spine
    ctx.beginPath()
    ctx.moveTo(px(0), py(top))
    ctx.lineTo(px(0), py(bottom))
    ctx.stroke()

    // Bowed cross spar
    ctx.strokeStyle = '#a6723b'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(px(-side), py(shoulder))
    ctx.quadraticCurveTo(px(0), py(shoulder + 0.25), px(side), py(shoulder))
    ctx.stroke()

    // Bamboo tied joint at cross intersection
    ctx.fillStyle = '#fff8e7'
    ctx.fillRect(px(0) - 5, py(shoulder + 0.12) - 5, 10, 10)

    // Outer perimeter string
    ctx.strokeStyle = 'rgba(40, 25, 10, 0.75)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(px(0), py(top))
    ctx.lineTo(px(-side), py(shoulder))
    ctx.lineTo(px(0), py(bottom))
    ctx.lineTo(px(side), py(shoulder))
    ctx.closePath()
    ctx.stroke()
  })
}

function makeLine(color: string, width: number): Line2 {
  const geo = new LineGeometry()
  geo.setPositions(new Float32Array(LINE_POINTS * 3))
  const mat = new LineMaterial({ color, linewidth: width, transparent: true, worldUnits: false })
  const line = new Line2(geo, mat)
  line.frustumCulled = false
  return line
}

/** The parts of a kite's sim state the view draws from. */
export type KiteLine = Pick<Kite, 'slack' | 'pulling' | 'status' | 'cutAt'>

export interface KitePose {
  x: number
  y: number
  heading: number
}

export class KiteView {
  readonly kite: THREE.Mesh
  private readonly line: Line2
  private readonly tail: Line2
  private readonly hand: THREE.Vector3
  private readonly z: number
  private readonly buffer = new Float32Array(LINE_POINTS * 3)
  private cutTime = -1
  private tailOffset = new THREE.Vector2()

  constructor(scene: THREE.Scene, index: 0 | 1) {
    const look = LOOKS[index]
    this.kite = new THREE.Mesh(
      kiteGeometry(),
      new THREE.MeshStandardMaterial({ map: sailTexture(look), side: THREE.DoubleSide, roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.08 }),
    )
    this.kite.scale.setScalar(KITE_SCALE)
    this.z = PLANE_Z - index * 0.4
    this.hand = new THREE.Vector3(HANDS[index].x, HANDS[index].y, HANDS[index].z)
    this.line = makeLine(look.line, 2)
    this.tail = makeLine(look.line, 2)
    this.tail.visible = false
    scene.add(this.kite, this.line, this.tail)
  }

  setResolution(width: number, height: number, pixelRatio: number): void {
    for (const l of [this.line, this.tail]) {
      const m = l.material
      m.resolution.set(width * pixelRatio, height * pixelRatio)
      m.linewidth = 1.6 * pixelRatio
    }
  }

  reset(): void {
    this.cutTime = -1
    this.tail.visible = false
    this.line.material.opacity = 1
  }

  update(k: KiteLine, pose: KitePose, time: number): void {
    const flutter = k.pulling && k.status === 'flying' ? 0.35 : 1
    this.kite.position.set(pose.x, pose.y, this.z)
    this.kite.rotation.set(Math.sin(time * 6.3) * 0.12 * flutter, Math.sin(time * 8.9) * 0.22 * flutter, pose.heading - Math.PI / 2, 'ZXY')

    if (k.status === 'cut' && k.cutAt) {
      if (this.cutTime < 0) {
        this.cutTime = time
        this.tailOffset.set(k.cutAt.x - pose.x, k.cutAt.y - pose.y)
      }
      const since = time - this.cutTime
      // The hand's end goes slack and falls away; the kite trails the rest.
      this.drawLine(this.line, k.cutAt, 2 + since * since * 4, null)
      this.line.material.opacity = Math.max(0, 1 - since / 2.5)
      const hang = Math.min(1, since / 1.5)
      const end = {
        x: pose.x + THREE.MathUtils.lerp(this.tailOffset.x, -2, hang) * (1 - 0.6 * hang),
        y: pose.y + THREE.MathUtils.lerp(this.tailOffset.y, -12, hang) * (1 - 0.3 * hang),
      }
      this.drawLine(this.tail, end, 0.5, { x: pose.x, y: pose.y })
      this.tail.visible = true
      return
    }
    const sag = 0.25 + k.slack * 0.14 + (k.pulling ? 0 : 0.3)
    const vibe = k.pulling && k.status === 'flying' ? time : 0
    this.drawLine(this.line, pose, sag, null, vibe)
  }

  /** Line from `from` (the hand when null) to `to` on the kite plane, sagging by `sag` metres. */
  private drawLine(line: Line2, to: Vec2, sag: number, from: Vec2 | null, vibe: number = 0): void {
    const sx = from ? from.x : this.hand.x
    const sy = from ? from.y : this.hand.y
    const sz = from ? this.z : this.hand.z
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1)
      const arch = 4 * t * (1 - t)
      const shake = vibe !== 0 ? Math.sin(vibe * 60 + i * 2.3) * 0.05 * arch : 0
      this.buffer[i * 3] = sx + (to.x - sx) * t + shake
      this.buffer[i * 3 + 1] = sy + (to.y - sy) * t - sag * arch + shake * 0.6
      this.buffer[i * 3 + 2] = sz + (this.z - sz) * t
    }
    ; (line.geometry as LineGeometry).setPositions(this.buffer)
  }
}
