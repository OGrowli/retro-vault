import { Hono } from 'hono'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import type { WifiNetwork, WifiStatus } from '@retro-vault/shared'

const pExecFile = promisify(execFile)

export const wifiRouter = new Hono()

const isLinux = process.platform === 'linux'

// Thin wrapper around nmcli. Reads run as the API user; changes (connect,
// disconnect) go through sudo so they work regardless of polkit setup — the
// device already relies on passwordless sudo for the update flow.
async function nmcli(args: string[], opts: { sudo?: boolean; timeout?: number; file?: string } = {}): Promise<string> {
  const bin = opts.file ?? 'nmcli'
  const file = opts.sudo ? 'sudo' : bin
  const argv = opts.sudo ? [bin, ...args] : args
  const { stdout } = await pExecFile(file, argv, { timeout: opts.timeout ?? 15_000 })
  return stdout
}

// nmcli --terse escapes ':' and '\' inside field values; undo that when splitting.
function splitTerse(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && i + 1 < line.length) { cur += line[i + 1]; i++ }
    else if (ch === ':') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

function nmcliError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { stderr?: string; message?: string; code?: string | number }
    if (err.code === 'ENOENT') return 'NetworkManager (nmcli) is not installed on this device.'
    const msg = (err.stderr || err.message || '').toString().trim()
    if (msg) return msg.split('\n')[0].replace(/^Error:\s*/, '')
  }
  return 'Wi-Fi command failed'
}

async function wifiDevice(): Promise<string | null> {
  const out = await nmcli(['-t', '-f', 'DEVICE,TYPE', 'device'])
  for (const line of out.split('\n')) {
    const [dev, type] = splitTerse(line)
    if (type === 'wifi' && dev) return dev
  }
  return null
}

// Local LAN IP straight from the OS — works regardless of whether the active
// connection is managed by NetworkManager or dhcpcd. Prefer wireless interfaces.
function localIp(): string | null {
  const ifaces = os.networkInterfaces()
  const names = Object.keys(ifaces).sort(
    (a, b) => (b.startsWith('wl') ? 1 : 0) - (a.startsWith('wl') ? 1 : 0)
  )
  for (const name of names) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

async function savedNames(): Promise<Set<string>> {
  try {
    const out = await nmcli(['-t', '-f', 'NAME', 'connection', 'show'])
    return new Set(out.split('\n').map(l => splitTerse(l)[0]).filter(Boolean))
  } catch {
    return new Set()
  }
}

wifiRouter.get('/status', async (c) => {
  // IP comes from the OS, so it's reported even when nmcli is absent or the
  // link is managed by dhcpcd. Each nmcli lookup is best-effort — a failure
  // never blanks the whole status.
  const ip = isLinux ? localIp() : null
  if (!isLinux) return c.json({ enabled: false, connected: false, ssid: null, ip } satisfies WifiStatus)

  let enabled = false
  try { enabled = (await nmcli(['radio', 'wifi'])).trim() === 'enabled' } catch { /* older nmcli / dhcpcd */ }

  let ssid: string | null = null
  try {
    const list = await nmcli(['-t', '-f', 'ACTIVE,SSID', 'device', 'wifi'])
    for (const line of list.split('\n')) {
      const [active, s] = splitTerse(line)
      if (active === 'yes' && s) { ssid = s; break }
    }
  } catch { /* no active AP / nmcli unavailable */ }

  // Fall back to iwgetid for the SSID when NetworkManager isn't in play.
  if (!ssid) {
    try { ssid = (await nmcli(['-r'], { file: 'iwgetid' })).trim() || null } catch { /* not connected */ }
  }

  return c.json({ enabled, connected: !!ssid, ssid, ip } satisfies WifiStatus)
})

wifiRouter.get('/scan', async (c) => {
  if (!isLinux) return c.json([] as WifiNetwork[])
  try {
    const [out, saved] = await Promise.all([
      // --rescan yes forces a fresh scan and waits for the results.
      nmcli(['-t', '-f', 'ACTIVE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes'], { timeout: 25_000 }),
      savedNames(),
    ])

    // Collapse duplicate SSIDs (multiple APs / bands) to the strongest signal.
    const best = new Map<string, WifiNetwork>()
    for (const line of out.split('\n')) {
      if (!line) continue
      const [active, ssid, signalStr, security] = splitTerse(line)
      if (!ssid) continue // hidden networks report an empty SSID
      const signal = parseInt(signalStr ?? '0', 10) || 0
      const isActive = active === 'yes'
      const existing = best.get(ssid)
      if (!existing) {
        best.set(ssid, { ssid, signal, security: security || null, active: isActive, saved: saved.has(ssid) })
      } else {
        if (signal > existing.signal) { existing.signal = signal; existing.security = security || null }
        if (isActive) existing.active = true
      }
    }

    const nets = [...best.values()].sort(
      (a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.signal - a.signal
    )
    return c.json(nets)
  } catch (e) {
    return c.json({ error: nmcliError(e) }, 500)
  }
})

wifiRouter.post('/connect', async (c) => {
  if (!isLinux) return c.json({ connected: false, error: 'Wi-Fi is only available on the device' }, 400)
  const body = await c.req.json<{ ssid?: string; password?: string }>().catch(() => ({} as { ssid?: string; password?: string }))
  const ssid = (body.ssid ?? '').trim()
  if (!ssid) return c.json({ connected: false, error: 'ssid required' }, 400)
  const password = typeof body.password === 'string' ? body.password : ''
  try {
    const args = ['device', 'wifi', 'connect', ssid]
    if (password) args.push('password', password)
    // Association + DHCP can be slow on the Pi's radio; give it room.
    await nmcli(args, { sudo: true, timeout: 45_000 })
    return c.json({ connected: true })
  } catch (e) {
    return c.json({ connected: false, error: nmcliError(e) })
  }
})

wifiRouter.post('/disconnect', async (c) => {
  if (!isLinux) return c.json({ ok: false, error: 'Wi-Fi is only available on the device' }, 400)
  try {
    const dev = await wifiDevice()
    if (dev) await nmcli(['device', 'disconnect', dev], { sudo: true, timeout: 20_000 })
    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: nmcliError(e) })
  }
})
