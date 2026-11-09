import type { Input } from './sim/match'

// Keyboard, mouse and touch, folded into the sim's Input. An online client
// would send exactly this per tick.

export class LocalInput {
  private keys = new Set<string>()
  private pointerPull = false
  private touchPull = false
  private touchSteer = 0

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(e.code)) e.preventDefault()
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.clear())

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId)
      this.pointerPull = true
    })
    const release = () => (this.pointerPull = false)
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)

    this.hold('btn-pull', (on) => (this.touchPull = on))
    this.hold('btn-left', (on) => (this.touchSteer = on ? 1 : this.touchSteer === 1 ? 0 : this.touchSteer))
    this.hold('btn-right', (on) => (this.touchSteer = on ? -1 : this.touchSteer === -1 ? 0 : this.touchSteer))
  }

  private hold(id: string, set: (on: boolean) => void): void {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      el.classList.add('held')
      set(true)
    })
    const up = () => {
      el.classList.remove('held')
      set(false)
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  clear(): void {
    this.keys.clear()
    this.pointerPull = false
    this.touchPull = false
    this.touchSteer = 0
  }

  read(): Input {
    const k = this.keys
    const pull = k.has('Space') || k.has('ArrowUp') || k.has('KeyW') || this.pointerPull || this.touchPull
    const left = k.has('KeyA') || k.has('ArrowLeft') || this.touchSteer === 1
    const right = k.has('KeyD') || k.has('ArrowRight') || this.touchSteer === -1
    return { pull, steer: left === right ? 0 : left ? 1 : -1 }
  }
}
