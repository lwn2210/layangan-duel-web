import { COUNTDOWN_TICKS, LINE_HP, MAX_SLACK, ROUND_TICKS, ROUNDS_TO_WIN, TICK_RATE } from './sim/constants'
import { windAt, type MatchState } from './sim/match'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

export class Hud {
  private readonly root = $('hud')
  private readonly hp = [$('hp0'), $('hp1')]
  private readonly slack = [$('slack0'), $('slack1')]
  private readonly pips = [$('pips0'), $('pips1')]
  private readonly speed = [$('speed0'), $('speed1')]
  private readonly round = $('round')
  private readonly clock = $('clock')
  private readonly wind = $('wind')
  private readonly gesek = $('gesek')
  private readonly banner = $('banner')
  private readonly bannerMain = $('banner-main')
  private readonly bannerSub = $('banner-sub')
  private bannerUntil = 0
  private lastScores = ''

  show(foeName: string): void {
    this.root.hidden = false
    $('foe-name').textContent = foeName
    this.pips.forEach((el) => (el.innerHTML = Array.from({ length: ROUNDS_TO_WIN }, () => '<i></i>').join('')))
    this.lastScores = ''
  }

  hide(): void {
    this.root.hidden = true
  }

  say(main: string, sub = '', seconds = 1.6, now = performance.now()): void {
    this.bannerMain.textContent = main
    this.bannerSub.textContent = sub
    this.banner.classList.add('show')
    this.bannerUntil = now + seconds * 1000
  }

  /** `mirrored`: the state is slot 1's mirrored view, so the wind blows the other way. */
  update(state: MatchState, now: number, mirrored = false, ping: number | null = null): void {
    state.kites.forEach((k, i) => {
      this.hp[i]!.style.width = `${Math.max(0, (k.hp / LINE_HP) * 100)}%`
      this.slack[i]!.style.width = `${(k.slack / MAX_SLACK) * 100}%`
      this.speed[i]!.textContent = k.lineSpeed.toFixed(0)
    })
    const scores = state.scores.join(':')
    if (scores !== this.lastScores) {
      this.lastScores = scores
      state.scores.forEach((s, i) => this.pips[i]!.querySelectorAll('i').forEach((el, j) => el.classList.toggle('on', j < s)))
    }
    this.round.textContent = `Ronde ${state.round}`
    const left = state.phase === 'fight' ? ROUND_TICKS - state.phaseTick : state.phase === 'countdown' ? ROUND_TICKS : 0
    const secs = Math.max(0, Math.ceil(left / TICK_RATE))
    this.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    const w = windAt(state)
    const drift = mirrored ? -w.drift : w.drift
    const arrow = Math.abs(drift) < 0.4 ? '·' : drift > 0 ? '→' : '←'
    this.wind.textContent = `Angin ${arrow} ${Math.round(w.power * 12)} km/j${ping === null ? '' : ` · ${ping} ms`}`
    this.gesek.hidden = !state.contact.active

    if (state.phase === 'countdown') {
      const n = Math.ceil((COUNTDOWN_TICKS - state.phaseTick) / TICK_RATE)
      this.bannerMain.textContent = String(n)
      this.bannerSub.textContent = `Ronde ${state.round}`
      this.banner.classList.add('show')
      this.bannerUntil = now + 300
    }
    if (now > this.bannerUntil) this.banner.classList.remove('show')
  }
}
