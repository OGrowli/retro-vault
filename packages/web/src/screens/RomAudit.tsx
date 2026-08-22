import { useState, useEffect, useRef, useCallback } from 'react'
import type { AuditStatus, AuditSystemSummary, AuditSystemReport } from '@retro-vault/shared'
import { api } from '../api/client'
import { useGamepad } from '../hooks/useGamepad'
import { Glyph } from '../components/Glyph'
import { StatusBar } from '../components/StatusBar'

interface Props {
  onBack: () => void
  inputActive?: boolean
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function RomAudit({ onBack, inputActive = true }: Props) {
  const [summaries, setSummaries] = useState<AuditSystemSummary[]>([])
  const [status, setStatus] = useState<AuditStatus | null>(null)
  const [view, setView] = useState<'overview' | 'detail'>('overview')
  const [detail, setDetail] = useState<AuditSystemReport | null>(null)
  const [tab, setTab] = useState<'missing' | 'unknown'>('missing')
  const [ovFocus, setOvFocus] = useState(0) // 0 = Run, 1..n = systems, n+1 = Back
  const [listFocus, setListFocus] = useState(0)
  const rowRefs = useRef<(HTMLElement | null)[]>([])
  const entryRefs = useRef<(HTMLElement | null)[]>([])

  const running = !!status?.running

  const loadSummaries = useCallback(() => {
    api.audit.report().then(setSummaries).catch(() => {})
  }, [])

  useEffect(() => {
    loadSummaries()
    api.audit.status().then(setStatus).catch(() => {})
  }, [loadSummaries])

  // Poll while a run is in progress; refresh summaries when it finishes.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      api.audit.status().then(s => {
        setStatus(s)
        if (!s.running) { clearInterval(id); loadSummaries() }
      }).catch(() => {})
    }, 1000)
    return () => clearInterval(id)
  }, [running, loadSummaries])

  const startRun = useCallback(async () => {
    if (running) return
    try {
      await api.audit.run()
      const s = await api.audit.status()
      setStatus({ ...s, running: true })
    } catch {}
  }, [running])

  const openDetail = useCallback(async (system: string) => {
    try {
      const report = await api.audit.system(system)
      setDetail(report)
      setTab('missing')
      setListFocus(0)
      setView('detail')
    } catch {}
  }, [])

  const backIdx = summaries.length + 1 // Run(0) + systems + Back

  useEffect(() => {
    if (view === 'overview') rowRefs.current[ovFocus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [ovFocus, view])
  useEffect(() => {
    if (view === 'detail') entryRefs.current[listFocus]?.scrollIntoView({ block: 'nearest' })
  }, [listFocus, view])

  const entries = detail ? (tab === 'missing' ? detail.missing : detail.unknown) : []

  useGamepad((action) => {
    if (view === 'detail') {
      if (action === 'back') { setView('overview'); return }
      if (action === 'left' || action === 'right') { setTab(t => (t === 'missing' ? 'unknown' : 'missing')); setListFocus(0); return }
      if (action === 'up') setListFocus(i => clamp(i - 1, 0, Math.max(0, entries.length - 1)))
      if (action === 'down') setListFocus(i => clamp(i + 1, 0, Math.max(0, entries.length - 1)))
      return
    }
    if (action === 'back') { onBack(); return }
    if (action === 'up') setOvFocus(i => clamp(i - 1, 0, backIdx))
    if (action === 'down') setOvFocus(i => clamp(i + 1, 0, backIdx))
    if (action === 'confirm') {
      if (ovFocus === 0) { if (!running) void startRun(); return }
      if (ovFocus === backIdx) { onBack(); return }
      const sys = summaries[ovFocus - 1]
      if (sys) void openDetail(sys.system)
    }
  }, inputActive)

  if (view === 'detail' && detail) {
    return (
      <div className="fixed inset-0 bg-vault-bg flex flex-col overflow-hidden">
        <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
          <div>
            <h1 className="text-white text-2xl font-bold tracking-tight">{detail.displayName}</h1>
            <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">
              {detail.have}/{detail.total} present · {detail.strategy === 'crc' ? 'Exact CRC match' : 'Name match'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {(['missing', 'unknown'] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); setListFocus(0) }}
                className={[
                  'px-4 py-2 rounded-xl text-sm font-bold uppercase tracking-wide border',
                  tab === t ? 'border-vault-accent ring-2 ring-vault-accent text-white bg-vault-surface' : 'border-vault-muted text-vault-muted',
                ].join(' ')}
              >
                {t === 'missing' ? `Missing ${detail.missingCount}` : `Unknown ${detail.unknownCount}`}
              </button>
            ))}
            <StatusBar />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-[5%] py-6" style={{ scrollbarWidth: 'none' }}>
          {entries.length === 0 ? (
            <p className="text-vault-muted text-sm py-8 text-center">
              {tab === 'missing' ? 'Nothing missing — you have every DAT title.' : 'No unknown ROMs — all recognized.'}
            </p>
          ) : (
            <div className="max-w-3xl mx-auto space-y-1">
              {entries.map((e, i) => (
                <div
                  key={`${e.name}-${i}`}
                  ref={el => { entryRefs.current[i] = el }}
                  onMouseEnter={() => setListFocus(i)}
                  className={[
                    'flex items-center gap-3 px-4 py-2 rounded-lg',
                    listFocus === i ? 'bg-vault-surface ring-2 ring-vault-accent' : 'bg-transparent',
                  ].join(' ')}
                >
                  <span className="flex-1 min-w-0 text-[0.9rem] text-[#d6d6e2] truncate">{e.name}</span>
                  {e.region && <span className="flex-shrink-0 text-[0.65rem] font-bold uppercase tracking-wider text-vault-muted">{e.region}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="px-[5%] py-4 border-t border-vault-surface">
          <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
            <Glyph type="circle" /> Back · ↑↓ Scroll · ← → Missing/Unknown
          </p>
        </footer>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-vault-bg flex flex-col">
      <header className="px-[5%] pt-[3%] pb-4 border-b border-vault-surface flex items-center gap-4">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">ROM Audit</h1>
          <p className="text-vault-muted text-xs uppercase tracking-widest mt-1">Check your collection against No-Intro</p>
        </div>
        <div className="ml-auto"><StatusBar /></div>
      </header>

      <div className="flex-1 overflow-y-auto px-[5%] py-8" style={{ scrollbarWidth: 'none' }}>
        <div className="space-y-3 max-w-2xl">
          <button
            ref={el => { rowRefs.current[0] = el }}
            onClick={() => { setOvFocus(0); if (!running) void startRun() }}
            onMouseEnter={() => setOvFocus(0)}
            disabled={running}
            className={[
              'w-full py-4 rounded-xl font-bold text-white uppercase tracking-wide text-sm',
              'bg-vault-accent', ovFocus === 0 ? 'ring-2 ring-white' : '', running ? 'opacity-70' : '',
            ].join(' ')}
          >
            {running
              ? `Auditing ${status?.currentSystem ?? ''}… ${status?.done ?? 0}/${status?.total ?? 0}`
              : 'Run Audit'}
          </button>

          {running && status && (
            <div className="h-2 rounded-full bg-vault-surface overflow-hidden">
              <div
                className="h-full bg-vault-accent transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${status.total ? (status.done / status.total) * 100 : 0}%` }}
              />
            </div>
          )}

          {summaries.length === 0 && !running && (
            <p className="text-vault-muted text-sm py-6 text-center">
              Run an audit to see which titles are missing from your cartridge systems.
            </p>
          )}

          {summaries.map((s, i) => {
            const slot = i + 1
            return (
              <button
                key={s.system}
                ref={el => { rowRefs.current[slot] = el }}
                onClick={() => { setOvFocus(slot); void openDetail(s.system) }}
                onMouseEnter={() => setOvFocus(slot)}
                className={[
                  'w-full py-4 px-5 rounded-xl text-left flex items-center gap-4',
                  'bg-vault-surface border transition-colors duration-150 motion-reduce:transition-none',
                  ovFocus === slot ? 'ring-2 ring-white border-vault-accent' : 'border-vault-muted',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-white font-bold uppercase tracking-wide text-sm">
                    {s.displayName}
                    <span className="ml-2 text-[0.6rem] text-vault-accent-bright">{s.strategy === 'crc' ? 'EXACT' : 'NAME'}</span>
                  </span>
                  <span className="block text-vault-muted text-[0.72rem] normal-case tracking-normal mt-0.5">
                    {s.have}/{s.total} present · {s.missingCount} missing
                    {s.unknownCount > 0 ? ` · ${s.unknownCount} unknown` : ''}
                  </span>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-vault-muted flex-shrink-0">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-[5%] py-4 border-t border-vault-surface flex items-center gap-4">
        <button
          ref={el => { rowRefs.current[backIdx] = el }}
          onClick={onBack}
          onMouseEnter={() => setOvFocus(backIdx)}
          className={[
            'px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wide',
            'bg-vault-surface text-white border border-vault-muted inline-flex items-center gap-2',
            ovFocus === backIdx ? 'ring-2 ring-white' : '',
          ].join(' ')}
        >
          <Glyph type="circle" /> Back
        </button>
        <p className="text-vault-muted text-xs uppercase tracking-wide flex items-center gap-1.5">
          <Glyph type="circle" /> Back · D-Pad Navigate · <Glyph type="cross" /> Select
        </p>
      </div>
    </div>
  )
}
