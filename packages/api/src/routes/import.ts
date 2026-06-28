import { Hono } from 'hono'
import { runImport } from '../importer.js'

export const importRouter = new Hono()

importRouter.post('/', async (c) => {
  try {
    const result = await runImport()
    return c.json(result)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})
