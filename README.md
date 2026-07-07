# Paste Sync

A web-based LAN sharing tool for syncing text, clipboard images, and files across devices.

[中文说明](./README_zh.md)

## Features

- **Password Login**: Sign in with a shared password and receive a JWT valid for 7 days.
- **Clipboard Sync**: Supports text plus uploading, viewing, and clearing the current clipboard image.
- **File Sharing**: Upload, download, delete, and preview image files.
- **Transfer Progress**: Shows upload/download progress and supports cancelling in-flight transfers.
- **Real-time Refresh**: Uses WebSocket events to refresh clipboard and file state.
- **Language and Theme Support**: Chinese / English plus Light / Dark / System themes.
- **Docker Deployment**: Quick startup with Docker Compose.

## Quick Start

### Requirements

- Docker + Docker Compose, or
- Node.js 18+ + npm

### Install

```bash
git clone https://github.com/AlakaSquasho/paste_sync.git
cd paste_sync
npm install
```

### Run with Docker

```bash
docker-compose up -d --build
```

Access:
- Frontend: http://localhost:8080
- Backend: http://localhost:3000

### Run locally for development

```bash
npm run dev
```

Access:
- Frontend: http://localhost:5173 (default, configurable via `VITE_DEV_PORT`)
- Backend: http://localhost:3000 (default, configurable via `PORT`)

### Production build

```bash
npm run build
npm run start
```

## Auth and Sync

- Login endpoint: `POST /api/auth/login`
- REST auth: `Authorization: Bearer <token>`
- WebSocket auth: `/ws?token=...`
- The server broadcasts `clipboard_updated` and `files_updated`, and clients refetch the relevant REST data

## Storage and Deployment

- Database: SQLite (via Prisma)
- General files: `server/uploads/`
- Clipboard images: `server/uploads/clipboard/`
- Logs: `server/logs/`
- Docker persists database, uploads, and logs via mounted volumes

A public reverse-proxy template is included: `nginx.reverse-proxy.template.conf`

- `/` → `127.0.0.1:8080`
- `/api`, `/ws` → `127.0.0.1:3000`

If you set `MAX_UPLOAD_SIZE_MB`, keep outer Nginx `client_max_body_size` aligned with it.

## Configuration

Configure these through `docker-compose.yml` or `.env`:

- `PORT`: backend port, default `3000`
- `DATABASE_URL`: SQLite connection string
- `SHARED_PASSWORD`: shared password, plaintext or Bcrypt hash
- `JWT_SECRET`: JWT signing secret
- `LOG_DIR`: log directory
- `IPINFO_API_KEY`: enrich access logs with IP geolocation
- `MAX_UPLOAD_SIZE_MB`: upload size limit, keep aligned with Nginx

Generate a password hash:

```bash
node -e "console.log(require('bcryptjs').hashSync('your_password', 10))"
```

## Common Commands

```bash
npm run dev
npm run build
npm run start
npm run dev --workspace=client
npm run dev --workspace=server
```

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, i18next
- Backend: Node.js, Express, Prisma, ws
- Database: SQLite
- Deployment: Nginx, Docker Compose

## License

MIT
