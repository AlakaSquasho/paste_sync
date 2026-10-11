// server/src/index.ts
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from the root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import app from './app';
import { initWebSocketServer } from './ws';
import { getDefaultAccount, validateAccountConfig } from './auth/accounts';
import { assertJwtSecret } from './auth/jwt';
import { runOwnershipBackfill } from './storage/backfillOwnership';

const PORT = process.env.PORT || 3000;

const main = async () => {
  // Fail fast on bad configuration rather than at the first request.
  validateAccountConfig();
  assertJwtSecret();

  // Assign pre-multi-account data to the default account before serving traffic.
  await runOwnershipBackfill(getDefaultAccount());

  const server = createServer(app);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
  });

  initWebSocketServer(wss);

  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
};

main().catch((error) => {
  console.error('[startup] failed:', error?.message ?? error);
  process.exit(1);
});
