import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

interface ClientSession {
  ws: WebSocket;
  uid: string;
  displayName: string;
  friends: Set<string>;
  lastState: Record<string, unknown> | null;
  coopPartnerUid: string | null;
  isAlive: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessions = new Map<string, ClientSession>();

  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      ok: true,
      status: 'healthy',
      playersOnline: sessions.size,
      uptimeSec: Math.round(process.uptime()),
      env: IS_PROD ? 'production' : 'development',
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/healthz', healthHandler);

  const broadcastPresence = () => {
    const onlineUids = Array.from(sessions.keys());
    const payload = JSON.stringify({ type: 'presence', onlineUids });
    for (const s of sessions.values()) {
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(payload);
      }
    }
  };

  const broadcastFriendsState = (sender: ClientSession) => {
    if (!sender.lastState) return;
    const msg = JSON.stringify({
      type: 'player_state',
      player: sender.lastState,
    });
    for (const other of sessions.values()) {
      if (other.uid === sender.uid || other.ws.readyState !== WebSocket.OPEN) continue;
      const isMutualOrListed =
        other.friends.has(sender.uid) ||
        sender.friends.has(other.uid) ||
        other.coopPartnerUid === sender.uid;
      if (isMutualOrListed) {
        other.ws.send(msg);
      }
    }
  };

  // Render reverse proxy heartbeat keeps idle WebSocket connections alive
  const heartbeatInterval = setInterval(() => {
    for (const [uid, session] of sessions.entries()) {
      if (!session.isAlive) {
        try {
          session.ws.terminate();
        } catch {
          // ignore
        }
        sessions.delete(uid);
        broadcastPresence();
        continue;
      }
      session.isAlive = false;
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.ping();
      }
    }
  }, 25000);

  wss.on('connection', (ws) => {
    let currentUid: string | null = null;

    ws.on('pong', () => {
      if (currentUid) {
        const s = sessions.get(currentUid);
        if (s) s.isAlive = true;
      }
    });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'ping') {
        if (currentUid) {
          const s = sessions.get(currentUid);
          if (s) s.isAlive = true;
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
        return;
      }

      if (type === 'hello') {
        const uid = String(msg.uid || '').trim();
        if (!uid) return;
        currentUid = uid;
        const friendsArr = Array.isArray(msg.friends)
          ? msg.friends.map((f) => String(f))
          : [];
        const existing = sessions.get(uid);
        if (existing && existing.ws !== ws) {
          try {
            existing.ws.close();
          } catch {
            // ignore
          }
        }
        const session: ClientSession = {
          ws,
          uid,
          displayName: String(msg.displayName || 'Hráč'),
          friends: new Set(friendsArr),
          lastState: null,
          coopPartnerUid: null,
          isAlive: true,
        };
        sessions.set(uid, session);
        broadcastPresence();
        for (const other of sessions.values()) {
          if (other.uid === uid || !other.lastState) continue;
          if (session.friends.has(other.uid) || other.friends.has(uid)) {
            ws.send(JSON.stringify({ type: 'player_state', player: other.lastState }));
          }
        }
        return;
      }

      if (!currentUid) return;
      const session = sessions.get(currentUid);
      if (!session) return;
      session.isAlive = true;

      if (type === 'update_friends') {
        const friendsArr = Array.isArray(msg.friends)
          ? msg.friends.map((f) => String(f))
          : [];
        session.friends = new Set(friendsArr);
        for (const other of sessions.values()) {
          if (other.uid === session.uid || !other.lastState) continue;
          if (session.friends.has(other.uid) || other.friends.has(session.uid)) {
            ws.send(JSON.stringify({ type: 'player_state', player: other.lastState }));
          }
        }
        return;
      }

      if (type === 'player_state' && typeof msg.player === 'object' && msg.player !== null) {
        session.lastState = msg.player as Record<string, unknown>;
        broadcastFriendsState(session);
        return;
      }

      if (type === 'mission_invite') {
        const toUid = String(msg.toUid || '');
        const target = sessions.get(toUid);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(
            JSON.stringify({
              type: 'mission_invite',
              inviteId: String(msg.inviteId || `${Date.now()}`),
              fromUid: session.uid,
              fromName: session.displayName,
              missionId: String(msg.missionId || ''),
              missionTitle: String(msg.missionTitle || ''),
              timestamp: Date.now(),
            })
          );
        }
        return;
      }

      if (type === 'mission_accept') {
        const fromUid = String(msg.fromUid || '');
        const partner = sessions.get(fromUid);
        session.coopPartnerUid = fromUid || null;
        if (partner) {
          partner.coopPartnerUid = session.uid;
          if (partner.ws.readyState === WebSocket.OPEN) {
            partner.ws.send(
              JSON.stringify({
                type: 'mission_accept',
                byUid: session.uid,
                byName: session.displayName,
                missionId: String(msg.missionId || ''),
              })
            );
          }
        }
        return;
      }

      if (type === 'mission_sync') {
        const targetUid = String(msg.toUid || session.coopPartnerUid || '');
        const target = sessions.get(targetUid);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(
            JSON.stringify({
              type: 'mission_sync',
              fromUid: session.uid,
              missionId: msg.missionId,
              stageIndex: msg.stageIndex,
              completed: Boolean(msg.completed),
              elapsedSec: Number(msg.elapsedSec || 0),
            })
          );
        }
        return;
      }
    });

    ws.on('close', () => {
      if (currentUid && sessions.get(currentUid)?.ws === ws) {
        sessions.delete(currentUid);
        const leftMsg = JSON.stringify({ type: 'player_left', uid: currentUid });
        for (const other of sessions.values()) {
          if (other.ws.readyState === WebSocket.OPEN) {
            other.ws.send(leftMsg);
          }
        }
        broadcastPresence();
      }
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(
        express.static(distDir, {
          maxAge: '1h',
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        })
      );
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      app.get('*', (_req, res) => {
        res.status(503).send('Build directory "dist" not found. Run "npm run build" first.');
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vice Horizon server listening on 0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down Vice Horizon server...`);
    clearInterval(heartbeatInterval);
    for (const s of sessions.values()) {
      try {
        s.ws.close(1001, 'Server restarting');
      } catch {
        // ignore
      }
    }
    wss.close(() => {
      server.close(() => {
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
