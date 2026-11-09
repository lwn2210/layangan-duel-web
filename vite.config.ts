import type { Server } from 'node:http'
import { defineConfig, type Plugin } from 'vitest/config'
import { attachGameServer } from './server/node'

/** Runs the multiplayer rooms inside the dev and preview servers, so `npm run dev` is the whole game. */
function gameServer(): Plugin {
  return {
    name: 'layangan-game-server',
    configureServer(server) {
      if (server.httpServer) attachGameServer(server.httpServer as Server)
    },
    configurePreviewServer(server) {
      attachGameServer(server.httpServer as Server)
    },
  }
}

export default defineConfig({
  plugins: [gameServer()],
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
