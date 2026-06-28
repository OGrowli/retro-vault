# RetroVault

PS5-style RetroPie frontend for Raspberry Pi 3B/3B+. Runs as a local Hono API + React SPA in Chromium kiosk mode.

## Requirements

- Raspberry Pi 3B/3B+ with RetroPie installed
- Node.js 18+ (`curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash - && sudo apt install nodejs`)
- RetroArch + libretro cores at `/opt/retropie/libretrocores/`
- EmulationStation gamelists at `/home/pi/.emulationstation/gamelists/`

## Setup

```bash
# Clone and install
git clone <repo> retro-vault && cd retro-vault
npm install

# Build shared types + API
npm run build -w packages/shared
npm run build -w packages/api

# Build web frontend
npm run build -w packages/web
```

## Running

```bash
# Start the API server (serves web + API on port 3000)
npm start
```

## Kiosk Mode (Pi)

Add to `/etc/rc.local` or an autostart script:

```bash
# Start API in background
cd /home/pi/retro-vault
node packages/api/dist/index.js &

# Wait for API to be ready
sleep 3

# Launch Chromium in kiosk mode
DISPLAY=:0 chromium-browser \
  --kiosk \
  --disable-extensions \
  --disable-gpu \
  --js-flags="--max-old-space-size=256" \
  --no-sandbox \
  http://localhost:3000
```

Or create a systemd service:

```ini
# /etc/systemd/system/retrovault.service
[Unit]
Description=RetroVault API
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/retro-vault
ExecStart=/usr/bin/node packages/api/dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable retrovault
sudo systemctl start retrovault
```

## Importing Games

Parses EmulationStation `gamelist.xml` files, resizes box art to 300×300px JPEG, and upserts into SQLite. Idempotent — safe to re-run.

```bash
# Via CLI
npm run import

# Via API
curl -X POST http://localhost:3000/import
```

Box art is cached to `/home/pi/.retrovault/media/<system>/`.

## Development

```bash
# Terminal 1: API with hot reload
npm run dev:api

# Terminal 2: Web with Vite dev server (http://localhost:5173)
npm run dev:web
```

The Vite dev server proxies `/games`, `/users`, `/meta`, `/import`, `/media` to `localhost:3000`.

## Adding System Core Mappings

Edit `packages/api/src/systems.config.ts`. Each system needs:

```typescript
your_system: {
  displayName: 'Display Name',
  corePath: '/opt/retropie/libretrocores/lr-core-name/core_libretro.so',
  extensions: ['.ext', '.zip'],
}
```

The system key must match the folder name in `/home/pi/.emulationstation/gamelists/`.

## Supported Systems

| ES Folder      | Core                      |
|----------------|---------------------------|
| `nes`          | lr-fceumm                 |
| `snes`         | lr-snes9x                 |
| `n64`          | lr-mupen64plus-next       |
| `psx`          | lr-pcsx-rearmed           |
| `gb` / `gbc`   | lr-gambatte               |
| `gba`          | lr-mgba                   |
| `megadrive`    | lr-genesis-plus-gx        |
| `mame-libretro`| lr-mame2003-plus          |
| `fba` / `fbneo`| lr-fbneo                  |

## Controller Layout (PS5 DualSense)

| Button   | Action              |
|----------|---------------------|
| D-Pad    | Navigate            |
| Cross ✕  | Confirm / Launch    |
| Circle ○ | Back                |
| Square □ | Toggle Favorite     |
| Options  | Toggle Filter Drawer|

## Data

SQLite database at `/home/pi/.retrovault/retrovault.db`. Schema migrates automatically on API startup. Media cached at `/home/pi/.retrovault/media/`.
