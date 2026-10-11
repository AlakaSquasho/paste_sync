import { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolveAccount } from './auth/accounts';
import { verifyToken } from './auth/jwt';

const HEARTBEAT_INTERVAL_MS = 30000;

type SyncEventType = 'clipboard_updated' | 'files_updated';

interface SyncEvent {
  type: SyncEventType;
  timestamp: number;
}

type TrackedWebSocket = WebSocket & { isAlive?: boolean; userId?: string };

// Sockets grouped by owning account, so a change only notifies that account's clients.
const clientsByUser = new Map<string, Set<TrackedWebSocket>>();
let heartbeatTimer: NodeJS.Timeout | null = null;

const parseToken = (req: IncomingMessage) => {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  return url.searchParams.get('token');
};

/** Returns the account that owns this socket handshake, or null if unauthorized. */
const authenticateSocket = (req: IncomingMessage): string | null => {
  const token = parseToken(req);
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  // Reject sockets belonging to an account that has since been removed from USERS.
  if (!resolveAccount(payload.sub)) return null;

  return payload.sub;
};

const sendEvent = (ws: TrackedWebSocket, event: SyncEvent) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
};

const allClients = (): TrackedWebSocket[] => {
  const sockets: TrackedWebSocket[] = [];
  clientsByUser.forEach((group) => group.forEach((ws) => sockets.push(ws)));
  return sockets;
};

const removeClient = (ws: TrackedWebSocket) => {
  const userId = ws.userId;
  if (!userId) return;

  const group = clientsByUser.get(userId);
  if (!group) return;

  group.delete(ws);
  if (group.size === 0) {
    clientsByUser.delete(userId);
  }
};

const startHeartbeat = () => {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    allClients().forEach((ws) => {
      if (ws.isAlive === false) {
        removeClient(ws);
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

    const userId = authenticateSocket(req);
    if (!userId) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.isAlive = true;
    ws.userId = userId;

    let group = clientsByUser.get(userId);
    if (!group) {
      group = new Set<TrackedWebSocket>();
      clientsByUser.set(userId, group);
    }
    group.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      removeClient(ws);
    });

    ws.on('error', () => {
      removeClient(ws);
    });
  });

  wss.on('close', () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });
};

/** Delivers an event only to the sockets owned by the given account. */
export const broadcastSyncEvent = (userId: string, type: SyncEventType) => {
  if (!websocketServer) return;

  const group = clientsByUser.get(userId);
  if (!group) return;

  const event: SyncEvent = {
    type,
    timestamp: Date.now(),
  };

  group.forEach((ws) => sendEvent(ws, event));
};
