import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';

const HEARTBEAT_INTERVAL_MS = 30000;

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

type SyncEventType = 'clipboard_updated' | 'files_updated';

interface SyncEvent {
  type: SyncEventType;
  timestamp: number;
}

type TrackedWebSocket = WebSocket & { isAlive?: boolean };

const clients = new Set<TrackedWebSocket>();
let heartbeatTimer: NodeJS.Timeout | null = null;

const parseToken = (req: IncomingMessage) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  return url.searchParams.get('token');
};

const isAuthorized = (req: IncomingMessage) => {
  const token = parseToken(req);
  if (!token) return false;

  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
};

const sendEvent = (ws: TrackedWebSocket, event: SyncEvent) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
};

const startHeartbeat = () => {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    clients.forEach((ws) => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
};

let websocketServer: WebSocketServer | null = null;

export const initWebSocketServer = (wss: WebSocketServer) => {
  websocketServer = wss;
  startHeartbeat();

  wss.on('connection', (rawWs, req) => {
    const ws = rawWs as TrackedWebSocket;

    if (!isAuthorized(req)) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.isAlive = true;
    clients.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  wss.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });
};

export const broadcastSyncEvent = (type: SyncEventType) => {
  if (!websocketServer) return;

  const event: SyncEvent = {
    type,
    timestamp: Date.now(),
  };

  clients.forEach((ws) => sendEvent(ws, event));
};
