/**
 * Provider Usage: desktop status-bar item (left cluster, after Cron).
 *
 * Data: this plugin's own backend namespace
 * (/api/plugins/provider-usage/usage, served by dashboard/plugin_api.py),
 * so provider credentials stay on the local machine.
 *
 * Compact layout (this fork): Codex, Anthropic and OpenCode Go, always Remaining.
 * OpenCode Go uses the Codex product (5h × weekly); monthly only matters at 0%.
 * Bottom bar: weekly remaining × session remaining / 100. Anthropic is
 * the mean of the per-account products (one per signed-in account), rounded
 * once at display time.
 * Popover: account rows with Session / Weekly values and reset times.
 * Missing Weekly data falls back to Session for the combined calculation.
 * Missing raw metrics still display as unknown in the account table.
 * Polling and threshold alerts continue through the existing backend.
 */
import { STATUSBAR_AREAS, atom, useQuery, useQueryClient, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'

const USAGE_KEY = ['plugin-provider-usage', 'backend']
const WARN_PCT = 80

const INTERVALS = [
  { label: '30s', ms: 30000 },
  { label: '1m', ms: 60000 },
  { label: '5m', ms: 300000 },
  { label: '10m', ms: 600000 }
]

/* Plugin-local state: poll cadence + value mode. Persisted via ctx.storage
 * (namespaced under hermes.plugin.provider-usage.*) so they survive restarts. */
const $interval = atom(300000)
const $mode = atom('remaining') // 'used' | 'remaining'
/* Which providers appear in the status bar. null = default (first provider
 * only); an array of ids = an explicit choice from the panel's eye toggles. */
const $barProviders = atom(['openai-codex', 'anthropic', 'opencode-go'])

/* Optional: pin Anthropic accounts to short names. Keys are the account labels
 * the backend prefixes onto window names ("<label> · 5h"); values are what the
 * panel shows. Leave empty to show every signed-in account as A1, A2, ... in
 * the order returned. When pinned, an account that does not answer keeps its
 * row and counts as 0%, and any other login (e.g. a Claude Code CLI login) is
 * left out of the average. Example: { 'work': 'A1', 'personal': 'A2' } */
let ACCOUNT_ALIASES = {}

const STORE_INTERVAL = 'intervalMs'
const STORE_MODE = 'valueMode'
const STORE_ALERTS = 'alerts'
const STORE_BAR = 'barProviders'

let storage = null
let osNotify = null
let rest = null

function persist(key, value) {
  if (!storage) return
  try {
    storage.set(key, value)
  } catch (e) {
    /* storage unavailable, session-only */
  }
}

function bindStorage(s) {
  storage = s
  try {
    const ms = storage.get(STORE_INTERVAL, null)
    if (INTERVALS.some(o => o.ms === ms)) $interval.set(ms)
    const mode = storage.get(STORE_MODE, null)
    if (mode === 'used' || mode === 'remaining') $mode.set(mode)
    const bar = storage.get(STORE_BAR, null)
    // The compact layout always shows these three, regardless of old settings.
    $barProviders.set(['openai-codex', 'anthropic', 'opencode-go'])
  } catch (e) {
    /* ignore malformed persisted state */
  }
  $interval.listen(v => persist(STORE_INTERVAL, v))
  $mode.listen(v => persist(STORE_MODE, v))
  $barProviders.listen(v => persist(STORE_BAR, v))
}

async function fetchUsage(fresh) {
  if (!rest) throw new Error('plugin backend not bound')
  return rest(fresh ? '/usage?fresh=1' : '/usage')
}

function useUsage() {
  const interval = useValue($interval)
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: () => fetchUsage(true),
    refetchInterval: interval,
    retry: 1,
    staleTime: 30000
  })
}

/* ---------- formatting / prediction helpers ---------- */

const CUR = { USD: '$', CNY: '\u00a5' }
const money = (v, cur) => {
  const n = Number(v) || 0
  const sign = n < 0 ? '-' : ''
  return sign + (CUR[cur] || '$') + Math.abs(n).toFixed(2)
}
const pct = v => Math.round(Number(v) || 0) + '%'
const CODE = {
  'opencode-go': 'opencode',
  'openai-codex': 'codex',
  openrouter: 'openrouter',
  anthropic: 'claude',
  copilot: 'copilot',
  nous: 'nous',
  zai: 'zai',
  'kimi-coding': 'kimi',
  minimax: 'minimax',
  deepseek: 'deepseek'
}
const code = p => p.id === 'openai-codex' ? 'Codex' : p.id === 'anthropic' ? 'Anthropic' : p.id === 'opencode-go' ? 'OpenCode' : (CODE[p.id] || p.id)
const DISPLAY_IDS = ['openai-codex', 'anthropic', 'opencode-go']
const DISPLAY_NAMES = { 'openai-codex': 'Codex', anthropic: 'Anthropic', 'opencode-go': 'OpenCode' }

function displayProviders(data) {
  const providers = data && Array.isArray(data.providers) ? data.providers : []
  return DISPLAY_IDS.map(id => providers.find(p => p.id === id) || {
    id, name: DISPLAY_NAMES[id], status: 'unavailable', windows: []
  })
}

// The backend prefixes multi-account windows with its account label. Keep that
// identity for grouping, but expose only short names (A1, A2, ...) and the two quota windows.
function quotaAccounts(p) {
  const accounts = new Map()
  const aliases = ACCOUNT_ALIASES
  for (const w of p.windows || []) {
    const match = String(w.label || '').match(/^(?:(.*?) · )?(5h|session|7d|weekly|monthly)$/i)
    if (!match) continue
    const key = match[1] || ''
    if (!accounts.has(key)) accounts.set(key, {
      label: p.id === 'anthropic' ? (aliases[key] || 'A' + (accounts.size + 1)) : p.id === 'opencode-go' ? 'OpenCode' : 'Codex'
    })
    const window = /^(5h|session)$/i.test(match[2]) ? 'session' : /^monthly$/i.test(match[2]) ? 'monthly' : 'weekly'
    accounts.get(key)[window] = w
  }
  // With pinned aliases, a distinct CLI login may be returned too: it is not
  // one of the pinned accounts and must not enter their mean or replace one.
  // A pinned account the backend did not return (rate-limited, rejected)
  // still gets its row, flagged missing; it counts as 0% remaining.
  const selected = Object.keys(aliases).filter(key => accounts.has(key))
  const rows = p.id === 'anthropic' && selected.length
    ? Object.keys(aliases).map(key => accounts.get(key) || { label: aliases[key], missing: true })
    : [...accounts.values()]
  return rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

function remaining(w) {
  if (!w || typeof w.percent !== 'number' || !Number.isFinite(w.percent)) return null
  return 100 - Math.max(0, Math.min(100, w.percent))
}

function combinedRemaining(p) {
  if (!p || p.status !== 'ok') return null
  const accounts = quotaAccounts(p)
  const pinned = Object.keys(ACCOUNT_ALIASES).length
  const expected = p.id === 'anthropic' ? (pinned || accounts.length) : 1
  if (!accounts.length || accounts.length !== expected) return null
  const products = accounts.map(a => {
    if (a.missing) return 0
    // OpenCode Go: same session × weekly product as Codex, but an exhausted
    // monthly cap still blocks everything, so it forces 0.
    if (p.id === 'opencode-go' && remaining(a.monthly) === 0) return 0
    const session = remaining(a.session), weekly = remaining(a.weekly)
    // An exhausted weekly window is 0% whatever the session reports (or omits).
    if (weekly === 0) return 0
    if (session === null) return null
    return weekly === null ? session : session * weekly / 100
  })
  if (products.some(v => v === null)) return null
  return products.reduce((sum, v) => sum + v, 0) / products.length
}

// hh:mm until capacity returns, only while the provider is fully exhausted.
// An account is blocked until every exhausted window of it has reset; the
// provider is back when its first account is. Unknown resets are never guessed.
function resetTimer(p, now = Date.now()) {
  if (combinedRemaining(p) !== 0) return null
  let soonest = null
  for (const a of quotaAccounts(p)) {
    if (a.missing) continue // no reading, so no reset time to wait for
    let back = -Infinity
    for (const w of [a.session, a.weekly, a.monthly]) {
      if (remaining(w) !== 0) continue
      const t = Date.parse(w.resets_at)
      if (!Number.isFinite(t)) return null
      back = Math.max(back, t)
    }
    if (back === -Infinity) return null
    soonest = soonest === null ? back : Math.min(soonest, back)
  }
  if (soonest === null || soonest <= now) return null
  const minutes = Math.ceil((soonest - now) / 60000)
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
}

function etaText(iso) {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!isFinite(ms)) return ''
  if (ms <= 0) return 'resets now'
  const mins = Math.round(ms / 60000)
  if (mins < 90) return 'resets in ' + mins + 'm'
  const hours = Math.floor(mins / 60)
  if (hours < 36) return 'resets in ' + hours + 'h ' + (mins % 60) + 'm'
  return 'resets in ' + Math.round(hours / 24) + 'd'
}

function fmtEta(sec) {
  const s = Number(sec)
  if (!isFinite(s) || s <= 0) return ''
  const mins = Math.round(s / 60)
  if (mins < 90) return '~' + mins + 'm'
  const hours = Math.floor(mins / 60)
  if (hours < 36) return '~' + hours + 'h'
  return '~' + Math.round(hours / 24) + 'd'
}

function usedPercentOf(w) {
  return Math.max(0, Math.min(100, Number(w && w.percent) || 0))
}

function capUsedPercent(m) {
  const total = Number(m && m.total) || 0
  const left = Number(m && m.left) || 0
  return total > 0 ? Math.max(0, Math.min(100, ((total - left) / total) * 100)) : 0
}

function providerWarn(p) {
  if (!p || p.status !== 'ok') return false
  for (const w of p.windows || []) if (usedPercentOf(w) >= WARN_PCT) return true
  for (const m of p.money || []) {
    if (m.label === 'Key cap' && capUsedPercent(m) >= WARN_PCT) return true
  }
  return false
}

/* Bar visibility: default is the FIRST provider only (provider list order);
 * once the user touches a toggle, an explicit id list decides. */
function barVisible(set, id, ids) {
  if (!Array.isArray(ids)) return false
  if (set === null) return ids.length > 0 && ids[0] === id
  return set.indexOf(id) !== -1
}

function toggleBarProvider(id, ids) {
  const cur = $barProviders.get()
  const effective = cur === null ? (ids.length ? [ids[0]] : []) : cur.slice()
  const next = effective.indexOf(id) === -1 ? effective.concat([id]) : effective.filter(x => x !== id)
  $barProviders.set(next)
}

/* A projection is actionable when the window would hit 100% BEFORE its own
 * reset (otherwise the reset saves you first). Without a reset time, only
 * projections inside a week are surfaced. */
function actionableEta(w) {
  const e = Number(w && w.eta_seconds)
  if (!isFinite(e) || e <= 0) return null
  if (w && w.resets_at) {
    const toReset = (Date.parse(w.resets_at) - Date.now()) / 1000
    if (isFinite(toReset) && e >= toReset) return null
  } else if (e > 7 * 86400) {
    return null
  }
  return e
}

/* ---------- alerts (native notification, deduped) ---------- */

function checkAlerts(data) {
  if (!storage || !data || !Array.isArray(data.providers)) return
  try {
    const seen = storage.get(STORE_ALERTS, {}) || {}
    const now = Date.now()
    const day = Math.floor(now / 86400000)
    let dirty = false

    const fire = (key, title, body) => {
      if (seen[key]) return
      seen[key] = now
      dirty = true
      if (osNotify) {
        try {
          osNotify({ title: title, body: body })
        } catch (e) {
          /* native notification unavailable */
        }
      }
    }

    for (const p of displayProviders(data)) {
      if (p.status !== 'ok') continue
      for (const w of p.windows || []) {
        const u = usedPercentOf(w)
        if (u < WARN_PCT) continue
        const eta = actionableEta(w)
        const bits = []
        if (eta) bits.push('At this rate, 100% in ' + fmtEta(eta))
        const r = etaText(w.resets_at)
        if (r) bits.push(r)
        fire(
          p.id + ':' + w.label + ':' + (w.resets_at || 'no-reset'),
          p.name + ': ' + w.label + ' at ' + Math.round(u) + '% used',
          bits.join(' · ')
        )
      }
      for (const m of p.money || []) {
        if (m.label !== 'Key cap') continue
        const u = capUsedPercent(m)
        if (u < WARN_PCT) continue
        const d = Number(m.depletes_in_seconds)
        const bits = []
        if (isFinite(d) && d > 0) bits.push('At this rate, exhausted in ' + fmtEta(d))
        bits.push(money(m.left, m.cur) + ' of ' + money(m.total, m.cur) + ' left')
        fire(
          p.id + ':' + m.label + ':' + day,
          p.name + ': ' + m.label + ' at ' + Math.round(u) + '% used',
          bits.join(' · ')
        )
      }
    }

    if (dirty) {
      const cut = now - 30 * 86400000
      const entries = Object.entries(seen)
        .filter(e => e[1] > cut)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 80)
      storage.set(STORE_ALERTS, Object.fromEntries(entries))
    }
  } catch (e) {
    /* never break the bar over alerts */
  }
}

/* Bottom bar is always combined REMAINING capacity, never Used mode. */
function summary(p) {
  const value = combinedRemaining(p)
  return value === null ? '-' : pct(value)
}

function remainingColor(value) {
  if (value === null) return 'var(--ui-text-quaternary)'
  if (value < 20) return 'var(--dt-destructive)'
  if (value <= 50) return 'var(--color-amber-500)'
  return 'var(--ui-success)'
}

function RemainingMeter({ name, value }) {
  const color = remainingColor(value)
  return jsx('span', {
    role: 'progressbar',
    'aria-label': name + ' remaining capacity',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': value === null ? undefined : value,
    'aria-valuetext': value === null ? 'Usage unavailable' : pct(value) + ' remaining',
    style: {
      display: 'block', width: '100%', height: 3, borderRadius: 3, overflow: 'hidden',
      background: value === null ? 'transparent' : 'color-mix(in srgb, ' + color + ' 40%, transparent)'
    },
    // Unknown shows a dim full bar so the slot never looks missing.
    children: value === null
      ? jsx('span', { style: { display: 'block', height: '100%', width: '100%', background: 'var(--ui-text-tertiary)', opacity: 0.45 } })
      : jsx('span', { style: { display: 'block', height: '100%', width: value + '%', background: color } })
  })
}

function BarDetail() {
  const { data, isError } = useUsage()
  useEffect(() => { if (data) checkAlerts(data) }, [data])
  // Re-render every 30s so a countdown keeps ticking between data refreshes.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30000)
    return () => clearInterval(id)
  }, [])
  const providers = displayProviders(isError ? null : data)
  return jsx('span', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 9, color: 'var(--ui-text-tertiary)', fontVariantNumeric: 'tabular-nums' },
    children: providers.map(p => {
      const value = combinedRemaining(p)
      const timer = resetTimer(p)
      return jsxs('span', {
        key: p.id,
        style: { display: 'inline-flex', flexDirection: 'column', gap: 2, minWidth: 72 },
        children: [
          jsx('span', { style: { whiteSpace: 'nowrap', lineHeight: '12px' }, children: code(p) + ' ' + summary(p) + (timer ? ' · ' + timer : '') }),
          jsx(RemainingMeter, { name: code(p), value })
        ]
      })
    })
  })
}

function BarTip() {
  const { data } = useUsage()
  return jsxs('div', {
    style: { fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 },
    children: [
      ...displayProviders(data).map(p => {
        const timer = resetTimer(p)
        return jsx('div', { key: p.id, children: code(p) + ' ' + summary(p) + ' remaining' + (timer ? ' · resets in ' + timer : '') })
      }),
      jsx('div', { style: { opacity: 0.7 }, children: 'Weekly × session; session only if weekly is unavailable. Anthropic: average of all signed-in accounts. OpenCode: same product; 0% if monthly is exhausted.' })
    ]
  })
}

/* ---------- compact quota table ---------- */
const MONO = 'tabular-nums'

function QuotaCell({ window }) {
  const value = remaining(window)
  const warn = value !== null && value <= 20
  return jsxs('td', {
    style: { width: '40%', padding: '7px 0 7px 16px', verticalAlign: 'top' },
    title: value === null ? 'Usage unavailable' : etaText(window.resets_at),
    children: [
      jsx('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
        children: [
          jsx('span', { style: { fontWeight: 600, fontSize: 13, fontVariantNumeric: MONO }, className: warn ? 'text-amber-600' : undefined, children: value === null ? '-' : pct(value) }),
          jsx('span', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)', whiteSpace: 'nowrap' }, children: value === null ? '' : etaText(window.resets_at).replace('resets in ', '') })
        ]
      }),
      jsx('div', {
        style: { height: 3, marginTop: 5, borderRadius: 3, background: 'var(--ui-stroke-tertiary)', overflow: 'hidden' },
        children: value === null ? null : jsx('div', { style: { height: '100%', width: value + '%', background: 'var(--ui-accent)', opacity: warn ? 0.5 : 0.9 } })
      })
    ]
  })
}

const clockTime = v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function ProviderBlock({ p, first }) {
  const accounts = quotaAccounts(p)
  const pinnedNames = Object.values(ACCOUNT_ALIASES)
  const placeholders = p.id === 'anthropic' ? (pinnedNames.length ? pinnedNames : ['A1']) : [code(p)]
  const rows = accounts.length ? accounts : placeholders.map(label => ({ label }))
  const heading = label => jsx('th', {
    key: label, scope: 'col',
    style: { textAlign: 'left', padding: '0 0 3px 16px', fontSize: 10, fontWeight: 500, color: 'var(--ui-text-tertiary)' },
    children: label
  })
  return jsxs('section', {
    style: { borderTop: first ? 'none' : '1px solid var(--ui-stroke-tertiary)', paddingTop: first ? 0 : 12 },
    children: [
      jsxs('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
        children: [
          jsx('span', { style: { fontWeight: 600, fontSize: 12 }, children: code(p) }),
          jsx('span', { style: { color: 'var(--ui-text-tertiary)', fontSize: 11, fontVariantNumeric: MONO }, title: 'Weekly remaining × session remaining; session only if weekly is unavailable. Anthropic averages all signed-in accounts.', children: summary(p) + ' combined' })
        ]
      }),
      jsx('table', {
        style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
        children: [
          jsx('thead', { key: 'head', children: jsx('tr', { children: [jsx('th', { key: 'account', scope: 'col', style: { width: '20%' }, children: '' }), heading('Session'), heading('Weekly')] }) }),
          jsx('tbody', { key: 'body', children: rows.map(a => jsx('tr', {
            key: a.label,
            children: [
              jsx('th', { scope: 'row', style: { textAlign: 'left', fontSize: 12, fontWeight: 500, padding: '7px 0', verticalAlign: 'top' }, children: p.id === 'anthropic' ? a.label : 'Account' }),
              jsx(QuotaCell, { window: p.status === 'ok' ? a.session : null }),
              jsx(QuotaCell, { window: p.status === 'ok' ? a.weekly : null })
            ]
          })) })
        ]
      }),
      p.status !== 'ok' ? jsx('div', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)' }, children: 'Usage unavailable' }) : null,
      p.stale && (p.hold_until || p.fetched_at)
        ? jsx('div', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)' }, children: [
            p.fetched_at ? 'last reading ' + clockTime(p.fetched_at) : null,
            p.hold_until ? 'retry after ' + clockTime(p.hold_until) : null
          ].filter(Boolean).join(' · ') })
        : null,
      p.status === 'ok' && p.id === 'opencode-go' && rows[0] && rows[0].monthly
        ? jsx('div', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)' }, children: 'Monthly ' + pct(remaining(rows[0].monthly)) + ' left' + (etaText(rows[0].monthly.resets_at) ? ' · ' + etaText(rows[0].monthly.resets_at) : '') + '. Combined = lowest of 5h, weekly, monthly.' })
        : null,
      p.status === 'ok' && rows.some(a => a.missing)
        ? jsx('div', { style: { fontSize: 10, color: 'var(--ui-text-tertiary)' }, children: rows.filter(a => a.missing).map(a => a.label).join(', ') + ' unavailable, counted as 0%' })
        : null
    ]
  })
}

/* ---------- footer controls ---------- */

function ModeSelect() {
  const mode = useValue($mode)
  const seg = (key, label) => {
    const active = mode === key
    return jsx('button', {
      type: 'button',
      onClick: () => $mode.set(key),
      style: {
        padding: '1px 7px', fontSize: 11, lineHeight: '16px', cursor: 'pointer', borderRadius: 5,
        border: '1px solid ' + (active ? 'var(--ui-accent, #6f9dff)' : 'var(--ui-stroke-tertiary, #3a3f4a)'),
        background: active ? 'color-mix(in srgb, var(--ui-accent, #6f9dff) 30%, transparent)' : 'transparent',
        color: 'inherit', opacity: active ? 1 : 0.72
      },
      children: label
    }, key)
  }
  return jsx('span', {
    style: { display: 'inline-flex', gap: 4 },
    children: [seg('used', 'Used'), seg('remaining', 'Remaining')]
  })
}

function IntervalSelect({ onChanged }) {
  const interval = useValue($interval)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = INTERVALS.find(o => o.ms === interval) || INTERVALS[2]

  return jsxs('span', {
    ref: wrapRef,
    style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5 },
    children: [
      jsx('span', { style: { opacity: 0.7 }, children: 'auto refresh' }),
      jsxs('button', {
        type: 'button',
        onClick: () => setOpen(v => !v),
        title: 'Refresh interval',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, lineHeight: '16px',
          border: '1px solid var(--ui-stroke-tertiary, #3a3f4a)', borderRadius: 5, background: 'transparent',
          color: 'inherit', cursor: 'pointer'
        },
        children: [
          jsx('span', { children: current.label }),
          jsx('svg', {
            viewBox: '0 0 24 24', width: 9, height: 9, fill: 'none', stroke: 'currentColor',
            strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round',
            children: jsx('path', { d: 'm6 9 6 6 6-6' })
          })
        ]
      }),
      open &&
        jsx('div', {
          style: {
            position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 40,
            display: 'flex', flexDirection: 'column', gap: 1, minWidth: 58, padding: 3,
            border: '1px solid var(--ui-stroke-tertiary, #3a3f4a)', borderRadius: 7,
            background: 'var(--ui-bg-elevated, #26272b)', boxShadow: '0 6px 18px rgba(0,0,0,.35)'
          },
          children: INTERVALS.map(o =>
            jsx('button', {
              key: o.ms,
              type: 'button',
              onClick: () => {
                $interval.set(o.ms)
                setOpen(false)
                if (onChanged) onChanged(o.ms)
              },
              style: {
                textAlign: 'left', padding: '2px 8px', fontSize: 11, border: 'none', borderRadius: 5, cursor: 'pointer',
                color: 'inherit',
                background: o.ms === interval ? 'color-mix(in srgb, var(--ui-accent, #6f9dff) 30%, transparent)' : 'transparent'
              },
              children: o.label
            })
          )
        })
    ]
  })
}

/* ---------- popover ---------- */

function UsagePanel() {
  const { data, isError } = useUsage()
  const qc = useQueryClient()
  const mode = useValue($mode)
  const [spinning, setSpinning] = useState(false)

  const refresh = () => {
    if (spinning) return
    setSpinning(true)
    fetchUsage(true)
      .then(d => qc.setQueryData(USAGE_KEY, d))
      .catch(() => {})
      .then(() => setTimeout(() => setSpinning(false), 600))
  }

  const stamp = data
    ? 'updated ' + new Date(data.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : isError
      ? 'unreachable'
      : 'loading…'

  const provs = displayProviders(data)
  const body = []
  const ids = provs.map(x => x.id)
  provs.forEach((p, i) => body.push(jsx(ProviderBlock, { p, first: i === 0, mode, ids }, p.id)))
  if (isError) {
    body.push(jsx('div', { key: 'down', style: { fontSize: 11 }, children: 'Backend unreachable. Enable the plugin and retry.' }))
  } else if (data && !provs.length) {
    body.push(jsx('div', { key: 'empty', style: { fontSize: 11 }, children: 'No providers available.' }))
  }

  return jsxs('div', {
    style: { display: 'flex', width: 320, flexDirection: 'column', gap: 12, padding: '14px 16px 12px', fontSize: 12 },
    children: [
      jsx('style', { key: 'kf', children: '@keyframes hermes-usage-spin{to{transform:rotate(360deg)}}' }),
      jsxs('div', {
        key: 'head',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
        children: [
          jsx('span', { style: { fontSize: 12, fontWeight: 650 }, children: 'Remaining capacity' }),
          jsxs('span', {
            style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.75 },
            children: [
              jsx('span', { style: { fontVariantNumeric: MONO }, children: stamp }),
              jsx('button', {
                type: 'button',
                onClick: refresh,
                title: 'Refresh usage',
                'aria-label': 'Refresh usage',
                style: {
                  display: 'inline-flex', width: 21, height: 21, alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--ui-stroke-tertiary, #3a3f4a)', borderRadius: 6,
                  background: 'transparent', color: 'inherit', cursor: 'pointer'
                },
                children: jsx('svg', {
                  viewBox: '0 0 24 24', width: 11, height: 11, fill: 'none', stroke: 'currentColor',
                  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
                  style: spinning ? { animation: 'hermes-usage-spin .7s linear 2' } : undefined,
                  children: [
                    jsx('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
                    jsx('path', { d: 'M21 3v5h-5' }),
                    jsx('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
                    jsx('path', { d: 'M8 16H3v5' })
                  ]
                })
              })
            ]
          })
        ]
      }),
      ...body,
      jsxs('div', {
        key: 'foot',
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          borderTop: '1px solid var(--ui-stroke-tertiary, #3a3f4a)', paddingTop: 6, fontSize: 11
        },
        children: [
          jsx(IntervalSelect, { onChanged: () => qc.refetchQueries({ queryKey: USAGE_KEY }) }, 'int'),
          jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: 'Remaining %' }, 'mode')
        ]
      })
    ]
  })
}

/* ---------- registration ---------- */

const ICON = jsx('svg', {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: { width: 12, height: 12, display: 'block' },
  children: [jsx('path', { d: 'm12 14 4-4' }), jsx('path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' })]
})

export default {
  id: 'provider-usage',
  name: 'Provider Usage',
  description: 'Per-provider quota and balance readout in the status bar.',
  register(ctx) {
    if (!storage) bindStorage(ctx.storage)
    try {
      osNotify = null // this compact layout keeps native notifications off
    } catch (e) {
      osNotify = null
    }
    try {
      rest = ctx.rest || null
    } catch (e) {
      rest = null
    }
    ctx.register({
      id: 'status',
      area: STATUSBAR_AREAS.left,
      order: 40,
      data: {
        id: 'provider-usage',
        icon: ICON,
        detail: jsx(BarDetail, {}),
        variant: 'menu',
        menuAlign: 'start',
        menuClassName: 'w-auto border-(--ui-stroke-secondary) p-0',
        menuContent: () => jsx(UsagePanel, {}),
        title: jsx(BarTip, {}),
        toggleLabel: 'Provider usage'
      }
    })
  }
}
