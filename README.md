# RetroVault

PS5-style RetroPie frontend for Raspberry Pi 3B/3B+. Runs as a local Hono API + React SPA in Chromium kiosk mode.

## Requirements

- Raspberry Pi 3B/3B+ with RetroPie installed
- Node.js 18+ (`curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash - && sudo apt install nodejs`)
- RetroArch + libretro cores at `/opt/retropie/libretrocores/`
- EmulationStation gamelists at `/home/pi/.emulationstation/gamelists/`

## Setup

```bash
git clone <repo> retro-vault && cd retro-vault
npm install
npm run build   # builds shared types, API, then web frontend
```

For first install on the Pi, prefer `npm run deploy` (see Deploying below) — it does the above plus sets up the systemd service and kiosk autostart in one step.

## Running

```bash
# Start the API server (serves web + API on port 3000)
npm start
```

## Deploying

`scripts/deploy.sh` handles both the first install and later updates — pulls latest (if the tree is clean), runs `npm install` + `npm run build`, then either installs the startup service (first run) or restarts it (`retrovault-api`). Run it from the Pi inside the cloned repo:

```bash
npm run deploy              # build + restart
npm run deploy -- --import  # also re-import games from EmulationStation gamelists
```

Web/frontend changes need a kiosk relaunch to show up — reboot the Pi, or `sudo pkill chromium-browser` if RetroPie's autostart will relaunch it.

## Kiosk Mode (Pi)

Startup is automated by `scripts/install-startup.sh` (run automatically by `deploy.sh` on first install, or directly):

```bash
bash scripts/install-startup.sh
```

This:
- Installs `scripts/retrovault-api.service` as a systemd unit (`retrovault-api`), enabled on boot, auto-restarts on failure.
- Hooks `scripts/retrovault-kiosk.sh` into RetroPie's `/opt/retropie/configs/all/autostart.sh` — it waits for the API to respond on `:3000`, disables screen blanking/cursor, then launches Chromium in kiosk mode against `http://localhost:3000`.

Useful commands:

```bash
sudo systemctl status retrovault-api   # check API status
sudo systemctl restart retrovault-api  # restart API
sudo journalctl -u retrovault-api -f   # tail API logs
sudo systemctl disable retrovault-api  # uninstall autostart
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
