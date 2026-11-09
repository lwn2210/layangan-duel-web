import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { normaliseRoomCode } from '../src/net/protocol'
import { Lobby } from './lobby'
import { Room, type Peer } from './room'

// Node adapter: hangs the rooms and the lobby off any http.Server, on
//   /ws/room/<CODE>   a duel (created by the first player to arrive)
//   /ws/match         the random-matchmaking queue
// Other upgrades (Vite's HMR socket) are left alone.

export interface GameServer {
  rooms: Map<string, Room>
  close(): void
}

export function attachGameServer(http: Server): GameServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  const rooms = new Map<string, Room>()
  const lobby = new Lobby()

  const peerOf = (ws: WebSocket): Peer => ({
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data)
    },
    close: () => ws.close(),
  })

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (!path.startsWith('/ws/')) return
    if (path === '/ws/match') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const peer = peerOf(ws)
        lobby.join(peer)
        ws.on('close', () => lobby.leave(peer))
      })
      return
    }
    const code = path.startsWith('/ws/room/') ? normaliseRoomCode(path.slice('/ws/room/'.length)) : null
    if (!code) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer = peerOf(ws)
      let room = rooms.get(code)
      if (!room) {
        room = new Room(code)
        rooms.set(code, room)
      }
      const r = room
      ws.on('message', (data) => r.message(peer, String(data)))
      ws.on('close', () => {
        r.leave(peer)
        if (r.empty) rooms.delete(code)
      })
    })
  }
  http.on('upgrade', onUpgrade)

  const timer = setInterval(() => {
    for (const room of rooms.values()) room.tick()
  }, 1000 / 120)

  return {
    rooms,
    close() {
      clearInterval(timer)
      http.off('upgrade', onUpgrade)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}
