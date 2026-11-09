import { MAX_SLACK } from './sim/constants'
import { windAt, type MatchState, type SimEvent } from './sim/match'

// Every sound is synthesised with Web Audio, so there are no files to ship.
// It only listens to the sim (state and events) and never feeds back into it.
// The context starts on the first tap or key press (iOS and Safari refuse to
// play before one). Note: on iPhone, the silent switch also mutes Web Audio.

const MUTE_KEY = 'layangan-duel.mute'

interface Loop {
  gain: GainNode
  filter: BiquadFilterNode
}

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private wind: Loop | null = null
  private flutter: Loop | null = null
  private saw: Loop | null = null
  private clickPhase = 0
  muted = false

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      this.muted = false
    }
    const unlock = () => this.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchend', unlock)
  }

  private unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.8
      this.master.connect(ctx.destination)
      const length = ctx.sampleRate * 2
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.wind = this.loop('bandpass', 420, 0.6)
      this.flutter = this.loop('bandpass', 260, 1.5)
      this.saw = this.loop('bandpass', 3400, 2.5)
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      // Not remembered; fine.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05)
    return this.muted
  }

  private loop(type: BiquadFilterType, freq: number, q: number): Loop {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(filter).connect(gain).connect(this.master!)
    src.start(0, Math.random() * 2)
    return { gain, filter }
  }

  private ready(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && this.master ? this.ctx : null
  }

  private tone(type: OscillatorType, from: number, to: number, start: number, length: number, volume: number): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, start)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(gain).connect(this.master!)
    osc.start(start)
    osc.stop(start + length + 0.02)
  }

  private hiss(type: BiquadFilterType, freq: number, start: number, length: number, volume: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bq = ctx.createBiquadFilter()
    bq.type = type
    bq.frequency.value = freq
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
    src.connect(bq).connect(gain).connect(this.master!)
    src.start(start, Math.random())
    src.stop(start + length + 0.02)
  }

  /**
   * Continuous sounds, every frame. `me` is the local player, whose kite we
   * hear up close; null in the menu demo, which only gets the wind.
   */
  update(state: MatchState, me: 0 | 1 | null, dt: number): void {
    const ctx = this.ready()
    if (!ctx || !this.wind || !this.flutter || !this.saw) return
    const t = ctx.currentTime
    const w = windAt(state)
    this.wind.gain.gain.setTargetAtTime(0.035 + 0.04 * (w.power - 0.8), t, 0.5)
    this.wind.filter.frequency.setTargetAtTime(340 + 200 * w.power, t, 0.5)

    const k = me === null ? null : state.kites[me]
    const flying = k?.status === 'flying' && state.phase !== 'countdown'
    this.flutter.gain.gain.setTargetAtTime(flying && k.pulling ? 0.07 + 0.03 * Math.sin(t * 90) : 0, t, 0.04)

    const fighting = me !== null && state.contact.active
    const grind = state.kites[0].lineSpeed + state.kites[1].lineSpeed
    this.saw.gain.gain.setTargetAtTime(fighting ? Math.min(0.2, 0.06 + grind * 0.006) * (0.75 + 0.25 * Math.random()) : 0, t, 0.02)
    this.saw.filter.frequency.setTargetAtTime(2600 + grind * 60, t, 0.05)

    // Reel ratchet: clicks faster the faster line pays out.
    if (flying && !k.pulling && k.slack < MAX_SLACK) {
      this.clickPhase += k.lineSpeed * 2.2 * dt
      while (this.clickPhase >= 1) {
        this.clickPhase -= 1
        this.tone('square', 2400, 1800, t, 0.012, 0.03)
      }
    } else this.clickPhase = 0
  }

  event(e: SimEvent, me: 0 | 1 | null): void {
    const ctx = this.ready()
    if (!ctx || me === null) return
    const t = ctx.currentTime
    switch (e.type) {
      case 'fight':
        this.tone('sine', 196, 180, t, 1.2, 0.25)
        this.tone('sine', 392, 380, t, 0.8, 0.08)
        break
      case 'contactStart':
        this.hiss('highpass', 3000, t, 0.12, 0.12)
        break
      case 'cut': {
        // "Tas!" as the line goes, then a whistle or a groan.
        this.hiss('highpass', 2500, t, 0.07, 0.4)
        this.tone('triangle', 1800, 300, t, 0.12, 0.15)
        if (e.player !== me) {
          this.tone('sine', 1300, 2500, t + 0.3, 0.2, 0.12)
          this.tone('sine', 1300, 2700, t + 0.6, 0.28, 0.12)
        } else {
          this.tone('triangle', 330, 196, t + 0.25, 0.7, 0.14)
        }
        break
      }
      case 'crash':
        this.tone('sine', 120, 45, t, 0.25, 0.3)
        this.hiss('lowpass', 1200, t, 0.3, 0.15)
        break
      case 'matchOver': {
        const notes = e.winner === me ? [523, 659, 784, 1047] : [392, 349, 311, 262]
        notes.forEach((f, i) => this.tone('triangle', f, f, t + i * 0.15, i === 3 ? 0.6 : 0.16, 0.13))
        break
      }
      default:
        break
    }
  }

  /** A beep per countdown second; call when the displayed number changes. */
  beep(final: boolean): void {
    const ctx = this.ready()
    if (!ctx) return
    this.tone('sine', final ? 990 : 660, final ? 990 : 660, ctx.currentTime, final ? 0.3 : 0.1, 0.12)
  }
}
