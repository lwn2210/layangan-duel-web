import * as THREE from 'three'
import { Sfx } from './audio'
import { Bot, type BotLevel } from './bot/bot'
import { Hud } from './hud'
import { LocalInput } from './input'
import { Matchmaker, OnlineGame, type OnlineStatus } from './net/online'
import { normaliseRoomCode, randomRoomCode } from './net/protocol'
import { Sparks } from './render/fx'
import { KiteView, type KitePose } from './render/kiteView'
import { World } from './render/world'
import { COUNTDOWN_TICKS, DT, TICK_RATE } from './sim/constants'
import { wrapAngle } from './sim/geometry'
import { CAMERA, PLANE_Z } from './sim/layout'
import { createMatch, step, type Input, type MatchState, type SimEvent } from './sim/match'

// Three ways to play, one renderer:
//  - local: the sim runs here at a fixed 60 Hz (vs the PC, or the menu demo
//    where two bots play), drawn with interpolation between ticks;
//  - online: the server runs the sim; snapshots arrive ~30 times a second and
//    are drawn interpolating between the last two.
// Either way the local player is kite 0 (online/mirror.ts handles slot 1).

type LocalSession = { kind: 'local'; state: MatchState; bots: [Bot | null, Bot]; live: boolean }
type Session = LocalSession | { kind: 'online'; net: OnlineGame; state: MatchState | null; snapAt: number }

const LEVEL_NAMES: Record<BotLevel, string> = { mudah: 'PC Mudah', sedang: 'PC Sedang', jago: 'PC Jago' }
const NICKNAMES = ['Ucup', 'Asep', 'Dimas', 'Rina', 'Bayu', 'Sari', 'Joko', 'Putri', 'Agus', 'Wulan', 'Eko', 'Tari', 'Udin', 'Nining']
const NAME_KEY = 'layangan-duel.name'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function storedName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY)
    if (saved) return saved
  } catch {
    // No storage: a fresh nickname each visit.
  }
  return NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)]!
}

export class App {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.5, 4000)
  private readonly world: World
  private readonly views: [KiteView, KiteView]
  private readonly sparks: Sparks
  private readonly hud = new Hud()
  private readonly input: LocalInput
  private readonly sfx = new Sfx()
  private lastCount = 0

  private session: Session
  /** An online game still connecting or waiting for its opponent; the demo keeps playing meanwhile. */
  private pending: OnlineGame | null = null
  private queue: Matchmaker | null = null
  private queueTimer = 0
  private fromQueue = false
  private level: BotLevel = 'sedang'
  private name = storedName()
  private prev: [KitePose, KitePose] = [
    { x: 0, y: 0, heading: 0 },
    { x: 0, y: 0, heading: 0 },
  ]
  private accumulator = 0
  private last = performance.now()
  private time = 0
  private lastMatch: { won: boolean; s0: number; s1: number; foe: string; isOnline: boolean } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    // The camera position is part of the sim's geometry (layout.ts); only its aim may change.
    this.camera.position.set(CAMERA.x, CAMERA.y, CAMERA.z)

    this.world = new World(this.scene)
    this.views = [new KiteView(this.scene, 0), new KiteView(this.scene, 1)]
    this.sparks = new Sparks(this.scene)
    this.input = new LocalInput(canvas)

    const demo = this.demo()
    this.session = demo
    this.capturePrev(demo.state)
    this.bindMenu()
    window.addEventListener('resize', () => this.resize())
    this.resize()
    this.renderer.setAnimationLoop(() => this.frame())

    const invited = normaliseRoomCode(new URLSearchParams(location.search).get('room') ?? '')
    if (invited) this.joinRoom(invited)
  }

  // ---- Menu and lobby -------------------------------------------------------

  private bindMenu(): void {
    const levels = $('levels')
    levels.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      this.level = btn.dataset.level as BotLevel
      levels.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn))
    })
    $('play').addEventListener('click', () => this.startBot())
    $('again').addEventListener('click', () => this.again())
    $('share-score').addEventListener('click', () => this.shareResult())
    $('to-menu').addEventListener('click', () => this.toMenu())

    const nameInput = $<HTMLInputElement>('player-name')
    nameInput.value = this.name
    nameInput.addEventListener('change', () => {
      this.name = nameInput.value.trim().slice(0, 16) || this.name
      nameInput.value = this.name
      try {
        localStorage.setItem(NAME_KEY, this.name)
      } catch {
        // Not remembered; fine.
      }
    })

    $('create-room').addEventListener('click', () => this.joinRoom(randomRoomCode()))
    $('join-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const field = $<HTMLInputElement>('join-code')
      const code = normaliseRoomCode(field.value)
      if (code) this.joinRoom(code)
      else {
        field.classList.add('bad')
        setTimeout(() => field.classList.remove('bad'), 600)
      }
    })
    $('find-match').addEventListener('click', () => this.findMatch())
    $('lobby-cancel').addEventListener('click', () => this.toMenu())
    $('lobby-bot').addEventListener('click', () => this.startBot())
    $('lobby-share').addEventListener('click', () => void this.share())

    const mute = $('mute')
    const showMute = () => (mute.textContent = this.sfx.muted ? '🔇' : '🔊')
    showMute()
    mute.addEventListener('click', () => {
      this.sfx.toggleMute()
      showMute()
    })
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.target instanceof HTMLInputElement) return
      this.sfx.toggleMute()
      showMute()
    })
  }

  private showOnly(id: 'menu' | 'lobby' | 'result' | null): void {
    for (const overlay of ['menu', 'lobby', 'result'] as const) $(overlay).hidden = overlay !== id
  }

  private lobby(title: string, sub: string, opts: { code?: string; share?: boolean; bot?: boolean; spin?: boolean } = {}): void {
    this.showOnly('lobby')
    $('lobby-title').textContent = title
    $('lobby-sub').textContent = sub
    $('lobby-code').textContent = opts.code ?? ''
    $('lobby-code').hidden = !opts.code
    $('lobby-share').hidden = !opts.share
    $('lobby-bot').hidden = !opts.bot
    $('lobby-spin').hidden = !opts.spin
  }

  private async share(): Promise<void> {
    const code = this.pending?.code
    if (!code) return
    const url = `${location.origin}${location.pathname}?room=${code}`
    const text = `Adu layangan sama aku! Kode room: ${code}`
    const btn = $('lobby-share')
    try {
      if (navigator.share) await navigator.share({ title: 'Layangan Duel', text, url })
      else {
        await navigator.clipboard.writeText(url)
        btn.textContent = 'Link disalin!'
        setTimeout(() => (btn.textContent = 'Bagikan link'), 1500)
      }
    } catch {
      // Share sheet dismissed, or no clipboard access: the code is on screen anyway.
    }
  }

  private leaveOnline(): void {
    this.pending?.close()
    this.pending = null
    this.queue?.close()
    this.queue = null
    clearTimeout(this.queueTimer)
    if (this.session.kind === 'online') this.session.net.close()
    if (location.search) history.replaceState(null, '', location.pathname)
  }

  private toMenu(): void {
    this.leaveOnline()
    this.useSession(this.demo())
    this.showOnly('menu')
    this.hud.hide()
  }

  private startBot(): void {
    this.leaveOnline()
    const seed = (Math.random() * 2 ** 32) >>> 0
    this.useSession({ kind: 'local', state: createMatch(seed), bots: [null, new Bot(1, this.level, seed ^ 0x9e3779b9)], live: true })
    this.input.clear()
    this.showOnly(null)
    this.hud.show(LEVEL_NAMES[this.level])
  }

  private again(): void {
    if (this.session.kind === 'online') {
      this.session.net.rematch()
      $('again').textContent = 'Nunggu lawan…'
      $<HTMLButtonElement>('again').disabled = true
    } else this.startBot()
  }

  private joinRoom(code: string): void {
    this.leaveOnline()
    this.pending = new OnlineGame(code, this.name, (s) => this.onNetStatus(s))
  }

  private findMatch(): void {
    this.leaveOnline()
    this.lobby('Nyari lawan…', 'Nunggu pemain lain masuk antrean.', { spin: true })
    this.queue = new Matchmaker({
      queued: (n) => $('lobby-sub').textContent = n > 1 ? `${n} orang di antrean.` : 'Kamu yang pertama di antrean. Nunggu pemain lain…',
      matched: (code) => {
        this.queue = null
        clearTimeout(this.queueTimer)
        this.fromQueue = true
        this.joinRoom(code)
      },
      failed: () => this.lobby('Gagal nyambung', 'Server multiplayer nggak bisa dihubungi.', { bot: true }),
    })
    // Nobody around? Offer the bot rather than an endless wait.
    this.queueTimer = window.setTimeout(() => ($('lobby-bot').hidden = false), 20000)
  }

  private onNetStatus(status: OnlineStatus): void {
    const net = this.session.kind === 'online' ? this.session.net : this.pending
    if (!net) return
    switch (status.kind) {
      case 'connecting':
        this.lobby(this.fromQueue ? 'Ketemu lawan!' : 'Nyambung…', 'Masuk ke room.', { code: net.code, spin: true })
        break
      case 'waiting':
        if (this.fromQueue) this.lobby('Ketemu lawan!', 'Nunggu dia masuk room…', { spin: true })
        else this.lobby('Nunggu teman…', 'Kasih kode ini ke teman, atau bagikan link-nya.', { code: status.code, share: true, spin: true })
        break
      case 'playing':
        this.fromQueue = false
        this.pending = null
        this.useSession({ kind: 'online', net, state: null, snapAt: 0 })
        this.input.clear()
        this.showOnly(null)
        $('again').textContent = 'Main lagi'
        $<HTMLButtonElement>('again').disabled = false
        this.hud.show(status.names[1])
        break
      case 'rematch':
        if (status.from === 'them') $('result-sub').textContent = `${net.names[1]} ngajak main lagi!`
        break
      case 'left':
        $('result-title').textContent = 'Lawan keluar'
        $('result-sub').textContent = `${net.names[1]} keluar atau koneksinya putus.`
        $('again').hidden = true
        this.showOnly('result')
        break
      case 'full':
        this.lobby('Room penuh', 'Kode ini lagi dipakai dua orang. Coba kode lain.')
        break
      case 'error':
        if (this.session.kind === 'online') {
          $('result-title').textContent = 'Koneksi putus'
          $('result-sub').textContent = status.reason
          $('again').hidden = true
          this.showOnly('result')
        } else this.lobby('Gagal nyambung', status.reason, { bot: true })
        break
    }
  }

  // ---- Loop ---------------------------------------------------------------------

  private demo(): LocalSession {
    const seed = (Math.random() * 2 ** 32) >>> 0
    return { kind: 'local', state: createMatch(seed), bots: [new Bot(0, 'sedang', seed + 1), new Bot(1, 'sedang', seed + 2)], live: false }
  }

  private useSession(session: Session): void {
    this.session = session
    this.views.forEach((v) => v.reset())
    $('again').hidden = false
    if (session.kind === 'local') this.capturePrev(session.state)
  }

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole kite plane (±48 m at 78 m) in view on narrow screens by widening vertically.
    const halfH = Math.atan(Math.tan(Math.atan(48 / 78)) / this.camera.aspect)
    this.camera.fov = Math.min(100, Math.max(58, THREE.MathUtils.radToDeg(halfH * 2)))
    this.camera.updateProjectionMatrix()
    for (const v of this.views) v.setResolution(w, h, this.renderer.getPixelRatio())
  }

  private capturePrev(state: MatchState): void {
    state.kites.forEach((k, i) => Object.assign(this.prev[i]!, { x: k.x, y: k.y, heading: k.heading }))
  }

  private frame(): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.time += dt

    const session = this.session
    let alpha = 1
    let live = true
    if (session.kind === 'local') {
      live = session.live
      this.accumulator += dt
      while (this.accumulator >= DT) {
        this.capturePrev(session.state)
        const state = session.state
        const before = state.round
        const inputs = session.bots.map((bot) => (bot ? bot.think(state) : this.input.read())) as [Input, Input]
        const events = step(state, inputs)
        if (state.round !== before) {
          this.views.forEach((v) => v.reset())
          this.capturePrev(state)
        }
        this.handle(events, live)
        this.accumulator -= DT
      }
      alpha = this.accumulator / DT
      if (!live && session.state.phase === 'matchOver') this.useSession(this.demo())
    } else {
      session.net.sendInput(this.input.read(), now)
      for (const snap of session.net.drain()) {
        const prev = session.state
        // A new round or a rematch restarts the kites: don't sweep them across the sky.
        const restart = !prev || snap.state.round !== prev.round || snap.state.tick < prev.tick
        if (restart) this.views.forEach((v) => v.reset())
        this.capturePrev(restart || !prev ? snap.state : prev)
        session.state = snap.state
        session.snapAt = now
        this.handle(snap.events, true)
      }
      alpha = Math.min(1, (now - session.snapAt) / session.net.snapInterval)
    }

    const state = this.session.state
    const online = this.session.kind === 'online' ? this.session.net : null
    if (state) {
      this.sfx.update(state, live ? 0 : null, dt)
      if (live && state.phase === 'countdown') {
        const n = Math.ceil((COUNTDOWN_TICKS - state.phaseTick) / TICK_RATE)
        if (n !== this.lastCount) this.sfx.beep(false)
        this.lastCount = n
      } else this.lastCount = 0
      if (live) this.hud.update(state, now, online?.slot === 1, online ? online.ping : null)
      this.draw(state, alpha, dt)
    } else this.renderer.render(this.scene, this.camera)
  }

  private handle(events: SimEvent[], live: boolean): void {
    for (const e of events) {
      this.onEvent(e, live)
      this.sfx.event(e, live ? 0 : null)
    }
  }

  private onEvent(e: SimEvent, live: boolean): void {
    if (e.type === 'cut') this.sparks.burst(e.x, e.y)
    if (!live) return
    switch (e.type) {
      case 'fight':
        this.hud.say('Adu!', '', 0.8)
        break
      case 'cut':
        this.hud.say('Putuuus!', e.player === 1 ? 'Layangan lawan putus!' : 'Layanganmu putus…', 2.6)
        break
      case 'crash':
        this.hud.say('Nyangkut!', e.player === 0 ? 'Layanganmu nyangkut di genteng.' : 'Layangan lawan nyangkut di genteng.', 2.6)
        break
      case 'roundOver':
        if (e.result.reason === 'time') {
          const sub = e.result.winner === 0 ? 'Benangmu lebih awet.' : e.result.winner === 1 ? 'Benang lawan lebih awet.' : 'Seri.'
          this.hud.say('Waktu habis', sub, 2.6)
        }
        break
      case 'matchOver': {
        const s = this.session.state
        const foe = this.session.kind === 'online' ? this.session.net.names[1] : 'Lawan Bot'
        const won = e.winner === 0
        this.lastMatch = {
          won,
          s0: s ? s.scores[0] : 0,
          s1: s ? s.scores[1] : 0,
          foe,
          isOnline: this.session.kind === 'online',
        }
        $('result-title').textContent = won ? 'Juara kampung!' : 'Kalah adu…'
        $('result-score').textContent = s ? `${s.scores[0]} – ${s.scores[1]}` : ''
        $('result-sub').textContent = won ? `Layangan ${foe} diambil anak-anak kampung.` : 'Besok beli gelasan yang lebih tajam.'
        this.showOnly('result')
        break
      }
      default:
        break
    }
  }

  private draw(s: MatchState, alpha: number, dt: number): void {
    s.kites.forEach((k, i) => {
      const p = this.prev[i]!
      const pose: KitePose = {
        x: p.x + (k.x - p.x) * alpha,
        y: p.y + (k.y - p.y) * alpha,
        heading: p.heading + wrapAngle(k.heading - p.heading) * alpha,
      }
      this.views[i]!.update(k, pose, this.time + i * 1.7)
    })
    this.sparks.update(dt, s.contact, this.time)
    this.world.update(dt)
    this.camera.lookAt(Math.sin(this.time * 0.13) * 0.6, 22 + Math.sin(this.time * 0.21) * 0.4, PLANE_Z)
    this.renderer.render(this.scene, this.camera)
  }

  private shareResult(): void {
    const m = this.lastMatch
    if (!m) return
    const status = m.won ? '🏆 JUARA ADU LAYANGAN KAMPUNG!' : '🪁 BENANG PUTUS / KALAH ADU'
    const text =
      `🪁 HASIL ADU GELASAN LAYANGAN DUEL 🪁\n` +
      `⚔️ Lawan: ${m.foe}\n` +
      `Status: ${status}\n` +
      `📊 Skor Ronde: ${m.s0} – ${m.s1}\n` +
      `🧵 Mode Duel: ${m.isOnline ? 'Online Mabar' : 'Lawan Bot'}\n\n` +
      `Bisa adu gelasan di langit kampung tanpa putus?\n` +
      `👉 https://lwn2210.github.io/mini-arcade/layangan-duel/`

    const btn = $('share-score')
    if (navigator.share) {
      navigator.share({ title: 'Adu Gelasan Layangan Duel!', text, url: 'https://lwn2210.github.io/mini-arcade/layangan-duel/' }).catch(() => {})
    } else if (navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          const orig = btn.textContent
          btn.textContent = '✅ Hasil disalin ke clipboard!'
          setTimeout(() => (btn.textContent = orig), 2500)
        })
        .catch(() => {
          window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank')
        })
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank')
    }
  }
}
