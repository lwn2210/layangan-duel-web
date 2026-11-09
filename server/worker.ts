import { normaliseRoomCode } from '../src/net/protocol'
import { Lobby } from './lobby'
import { Room, type Peer } from './room'

// Cloudflare adapter: the Worker serves the built game (static assets) and
// routes the sockets to Durable Objects, one per room code plus one global
// matchmaking lobby. The room and lobby logic is the same as the Node server.
//   npm run build && npm run cf:dev       (local, needs Node 22+)
//   npm run cf:deploy                     (your Cloudflare account)

interface Env {
  ROOMS: DurableObjectNamespace
  LOBBY: DurableObjectNamespace
  ASSETS: Fetcher
}

/** Accepts a WebSocket upgrade and hands the server end to `open`. */
function accept(open: (peer: Peer, socket: WebSocket) => void): Response {
  const pair = new WebSocketPair()
  const client = pair[0]
  const socket = pair[1]
  socket.accept()
  const peer: Peer = {
    send: (data) => {
      try {
        socket.send(data)
      } catch {
        // Already closing; the close handler cleans up.
      }
    },
    close: () => {
      try {
        socket.close(1000, 'bye')
      } catch {
        // Already closed.
      }
    },
  }
  open(peer, socket)
  return new Response(null, { status: 101, webSocket: client })
}

const notSocket = () => new Response('Expected a WebSocket upgrade', { status: 426 })

export class RoomObject {
  private room: Room | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return notSocket()
    const code = normaliseRoomCode(new URL(request.url).pathname.split('/').pop() ?? '')
    if (!code) return new Response('Bad room code', { status: 400 })
    const room = (this.room ??= new Room(code))
    return accept((peer, socket) => {
      socket.addEventListener('message', (e) => room.message(peer, typeof e.data === 'string' ? e.data : ''))
      const gone = () => {
        room.leave(peer)
        if (room.empty) this.stop()
      }
      socket.addEventListener('close', gone)
      socket.addEventListener('error', gone)
      // The sim runs on the wall clock while anyone is connected.
      this.timer ??= setInterval(() => this.room?.tick(), 1000 / 120)
    })
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.room = null
  }
}

export class LobbyObject {
  private readonly lobby = new Lobby()

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return notSocket()
    return accept((peer, socket) => {
      this.lobby.join(peer)
      const gone = () => this.lobby.leave(peer)
      socket.addEventListener('close', gone)
      socket.addEventListener('error', gone)
    })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/ws/match') return env.LOBBY.get(env.LOBBY.idFromName('global')).fetch(request)
    if (path.startsWith('/ws/room/')) {
      const code = normaliseRoomCode(path.slice('/ws/room/'.length))
      if (!code) return new Response('Bad room code', { status: 400 })
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
