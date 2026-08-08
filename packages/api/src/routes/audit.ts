import { Hono } from 'hono'
import { runAudit, auditStatus, latestSummaries, systemReport } from '../audit.js'
import { auditableSystems } from '../dat.js'

export const auditRouter = new Hono()

// Systems that can be audited (have a DAT source).
auditRouter.get('/systems', (c) => c.json(auditableSystems()))

// Kick off a background audit. Optional { systems: string[] } scopes it.
auditRouter.post('/run', async (c) => {
  const body = await c.req.json<{ systems?: string[] }>().catch(() => ({} as { systems?: string[] }))
  if (auditStatus().running) return c.json({ started: false, running: true })
  void runAudit(body.systems)
  return c.json({ started: true })
})

auditRouter.get('/status', (c) => c.json(auditStatus()))

// Per-system summaries (no big lists) for the overview.
auditRouter.get('/report', (c) => c.json(latestSummaries()))

// Full report for one system, including the missing + unknown lists.
auditRouter.get('/report/:system', (c) => {
  const report = systemReport(c.req.param('system'))
  if (!report) return c.json({ error: 'No audit for that system yet' }, 404)
  return c.json(report)
})
