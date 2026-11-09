import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { attachGameServer } from './node'

// Self-hosting in one process: serves the built game from dist/ and the
// multiplayer sockets on the same port (a VPS, Render, Fly...).
//   npm run build && PORT=8080 npm run serve

const PORT = Number(process.env.PORT ?? 8080)
const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
}

const http = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
  if (path === '/health') {
    res.end('ok')
    return
  }
  let file = normalize(join(DIST, path))
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  if (file.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  createReadStream(file).pipe(res)
})

attachGameServer(http)
http.listen(PORT, () => console.log(`Layangan Duel on http://localhost:${PORT}`))
