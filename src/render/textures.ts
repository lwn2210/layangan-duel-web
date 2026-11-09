import * as THREE from 'three'

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

const cache = new Map<string, THREE.CanvasTexture>()

/** A texture painted once on a canvas and shared under `key`. */
export function canvasTexture(key: string, w: number, h: number, draw: Draw): THREE.CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** Sprinkles low-contrast speckle over the canvas so flat colours read as material. */
export function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
}

export function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 800,
): void {
  ctx.fillStyle = color
  ctx.font = `${weight} ${size}px "Lilita One", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}
