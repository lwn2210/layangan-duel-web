import './style.css'
import { App } from './app'

async function boot(): Promise<void> {
  // Kite sails are painted on canvases with the display font; give it a moment to load.
  await Promise.race([document.fonts.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))])
  const app = new App(document.getElementById('scene') as HTMLCanvasElement)
  // Handle for poking at the match from the console while developing.
  if (import.meta.env.DEV) Object.assign(window, { __app: app })
}

void boot()
