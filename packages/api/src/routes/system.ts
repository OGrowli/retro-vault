import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const systemRouter = new Hono()

// Resolved from the service's WorkingDirectory (repo root), same as launch-game.sh.
const DEPLOY_SCRIPT = path.resolve('scripts/deploy.sh')
const DATA_DIR = process.env['RETROVAULT_DATA_DIR'] ?? path.join(os.homedir(), '.retrovault')

// Runs scripts/deploy.sh (git pull → npm build → restart service → reboot).
// Detached + unref'd so it outlives this request and the reboot that ends it;
// output is appended to ~/.retrovault/deploy.log for post-mortem.
systemRouter.post('/update', (c) => {
  if (process.platform !== 'linux') {
    return c.json({ error: 'Update is only available on the device' }, 400)
  }
  if (!fs.existsSync(DEPLOY_SCRIPT)) {
    return c.json({ error: `Deploy script not found: ${DEPLOY_SCRIPT}` }, 500)
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  const out = fs.openSync(path.join(DATA_DIR, 'deploy.log'), 'a')

  const child = spawn('bash', [DEPLOY_SCRIPT], {
    detached: true,
    stdio: ['ignore', out, out],
    cwd: path.dirname(path.dirname(DEPLOY_SCRIPT)),
  })
  child.unref()

  return c.json({ started: true })
})
