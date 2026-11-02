const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../desktop/plugin.js'), 'utf8')
  .replace(/^import .* from .*\n/gm, '')
  .replace('export default {', 'globalThis.plugin = {')
const w = (label, percent) => ({ label, percent, resets_at: '2030-01-01T00:00:00Z' })
const codex = { id: 'openai-codex', name: 'OpenAI Codex', status: 'ok', windows: [w('5h', 20), w('7d', 50)] }
const anthropic = { id: 'anthropic', name: 'Anthropic', status: 'ok', windows: [
  w('long-account-one · 5h', 20), w('long-account-one · 7d', 50), w('long-account-one · 7d Opus', 99),
  w('long-account-two · 5h', 50), w('long-account-two · 7d', 20),
  w('long-account-three · 5h', 0), w('long-account-three · 7d', 40)
], money: [{ label: 'Credits', left: 9, total: 10 }] }
let payload = { fetched_at: '2030-01-01T00:00:00Z', providers: [
  {id: 'opencode-go', name: 'OpenCode Go', status: 'ok', windows: [w('5h', 3), w('7d', 10), w('Monthly', 60)]},
  {id: 'openrouter', name: 'OpenRouter', status: 'ok', money: []}, anthropic, codex
] }
const context = vm.createContext({
  STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
  atom(value) { return { get: () => value, set: next => { value = next }, listen() {} } },
  jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
  useQuery: () => ({ data: payload, isError: false }), useQueryClient: () => ({}),
  useValue: atom => atom.get(), useEffect() {}, useRef: () => ({current: null}), useState: value => [value, () => {}], setTimeout
})
vm.runInContext(source, context)
function text(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (typeof node !== 'object') return String(node)
  if (typeof node.type === 'function') return text(node.type(node.props))
  return text(node.props.children)
}
// Pin three Anthropic accounts by backend label, as a user with three logins would.
const pin = aliases => vm.runInContext('ACCOUNT_ALIASES = ' + JSON.stringify(aliases), context)
pin({ 'acct-a': 'A1', 'acct-b': 'A2', 'acct-c': 'A3' })
context.plugin.register({storage: { get: (key, fallback) => key === 'valueMode' ? 'used' : key === 'barProviders' ? ['opencode-go', 'openrouter'] : fallback, set() {} }, rest: async () => payload, os: {}, register() {}})
assert.equal(context.summary(codex, 'used'), '40%', 'Bottom summary always multiplies remaining windows, independent of Used mode')
assert.equal(context.summary(anthropic, 'remaining'), '47%', 'Mean of three account products, rounded only once')
assert.equal(context.summary({...codex, windows: [w('5h', 20)]}, 'remaining'), '80%', 'Missing weekly metric falls back to session remaining')
assert.equal(context.summary({...codex, windows: [w('7d', 20)]}), '-', 'Missing session still stays unknown')
assert.equal(context.summary({...codex, windows: [w('5h', 20), w('7d', 100)]}), '0%', 'Known exhausted weekly quota does not trigger fallback')
assert.equal(context.summary({...codex, windows: [w('5h', 20), w('7d', null)]}), '80%', 'Null weekly percentage falls back to session remaining')
assert.equal(context.summary({...codex, windows: [w('5h', 100)]}), '0%', 'Exhausted session stays zero without weekly data')
assert.equal(context.summary({...anthropic, windows: anthropic.windows.slice(0, 5)}, 'remaining'), '-', 'Do not silently average fewer than three accounts')
const bar = text(context.BarDetail())
assert.match(bar, /Codex 40%/)
assert.match(bar, /Anthropic 47%/)
assert.match(bar, /OpenCode 87%/, 'OpenCode shows 5h remaining x weekly remaining / 100 (97 x 90 / 100), monthly ignored')
assert.doesNotMatch(bar, /openrouter|claude/i)
const panel = text(context.UsagePanel())
assert.match(panel, /A1/); assert.match(panel, /A2/); assert.match(panel, /A3/)
assert.match(panel, /Session/); assert.match(panel, /Weekly/)
assert.match(panel, /Monthly 40% left/)
assert.doesNotMatch(panel, /openrouter|long-account|Opus|Sonnet|Credits/i)
const tip = text(context.BarTip())
assert.doesNotMatch(tip, /openrouter|long-account|Opus|Credits/i)
payload = { providers: [] }
assert.match(text(context.BarDetail()), /Codex -.*Anthropic -.*OpenCode -/)
const liveShape = { id: 'anthropic', status: 'ok', windows: [
  w('acct-b · 5h', 8), w('acct-a · 5h', 100), w('acct-a · 7d', 14), w('acct-c · 5h', 23)
] }
const accounts = context.quotaAccounts(liveShape)
assert.equal(accounts[0].label, 'A1', 'Account numbers follow identity, not fetch order')
assert.equal(context.remaining(accounts[0].session), 0, 'Exhausted session stays zero')
assert.equal(context.remaining(accounts[0].weekly), 86, 'Weekly remains independently visible')
assert.equal(accounts[1].label, 'A2')
assert.equal(accounts[2].label, 'A3')
assert.equal(context.remaining(accounts[1].weekly), null, 'No invented weekly metric for account 2')
const exhaustedAccounts = { id: 'anthropic', status: 'ok', windows: [
  w('acct-c · 5h', 100), w('acct-b · 5h', 18), w('acct-a · 5h', 100), w('acct-a · 7d', 14)
] }
assert.equal(context.summary(exhaustedAccounts), '27%', 'Average of 0%, 82%, 0% remaining using session-only fallback')
payload = { providers: [codex, exhaustedAccounts] }
assert.match(text(context.BarDetail()), /Anthropic 27%/, 'Bottom bar uses fallback calculation')
const fallbackPanel = text(context.UsagePanel())
assert.match(fallbackPanel, /82%/, 'Popup retains actual session remaining')
assert.equal(context.remaining(context.quotaAccounts(exhaustedAccounts)[1].weekly), null, 'Fallback must not fabricate a weekly value')
const extraLogin = { ...exhaustedAccounts, windows: [...exhaustedAccounts.windows, w('Claude Code · 5h', 18)] }
assert.equal(context.summary(extraLogin), '27%', 'Additional CLI login must not invalidate the three pinned accounts')
assert.equal(context.quotaAccounts(extraLogin).length, 3, 'Only A1/A2/A3 appear, not A4')
const wr0 = (label, percent, minutes) => ({ label, percent, resets_at: new Date(Date.now() + minutes * 60000 - 500).toISOString() })
const missingPoolAccount = { ...extraLogin, windows: extraLogin.windows.filter(window => !window.label.startsWith('acct-c ·')) }
assert.equal(context.summary(missingPoolAccount), '27%', 'Missing A3 counts as 0%; extra CLI login does not substitute for it')
const missingA1 = { id: 'anthropic', status: 'ok', windows: [w('acct-c · 5h', 47), w('acct-b · 5h', 0), w('claude_code · 5h', 0)] }
const missingA1Rows = context.quotaAccounts(missingA1)
assert.deepEqual(Array.from(missingA1Rows, a => a.label), ['A1', 'A2', 'A3'], 'Missing A1 keeps its row')
assert.equal(missingA1Rows[0].missing, true)
assert.equal(context.summary(missingA1), '51%', 'Missing A1 counts as 0%: (0 + 100 + 53) / 3')
payload = { providers: [codex, missingA1] }
assert.match(text(context.UsagePanel()), /A1 unavailable, counted as 0%/)
assert.equal(context.resetTimer({ id: 'anthropic', status: 'ok', windows: [wr0('acct-c · 5h', 100, 45), wr0('acct-b · 5h', 100, 90)] }), '00:45', 'Missing account does not block the countdown')
payload = { providers: [codex, exhaustedAccounts] }
function findNodes(node, predicate) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(child => findNodes(child, predicate))
  if (typeof node.type === 'function') return findNodes(node.type(node.props), predicate)
  return [...(predicate(node) ? [node] : []), ...findNodes(node.props.children, predicate)]
}
const meters = findNodes(context.BarDetail(), node => node.props.role === 'progressbar')
assert.equal(meters.length, 3, 'Exactly one thin bottom bar per visible provider')
assert.equal(meters[0].props['aria-valuenow'], 40)
assert.equal(meters[0].props.children.props.style.width, '40%')
assert.equal(meters[1].props['aria-label'], 'Anthropic remaining capacity')
assert.ok(Math.abs(meters[1].props['aria-valuenow'] - 82 / 3) < 1e-10)
assert.equal(context.remainingColor(51), 'var(--ui-success)')
assert.equal(context.remainingColor(50), 'var(--color-amber-500)')
assert.equal(context.remainingColor(20), 'var(--color-amber-500)')
assert.equal(context.remainingColor(19), 'var(--dt-destructive)')
assert.equal(context.remainingColor(0), 'var(--dt-destructive)')
assert.equal(context.remainingColor(null), 'var(--ui-text-quaternary)')
const zero = context.RemainingMeter({ name: 'Anthropic', value: 0 })
assert.equal(zero.props.children.props.style.width, '0%', 'Zero stays visually empty, never a minimum fake fill')
const unknown = context.RemainingMeter({ name: 'Codex', value: null })
assert.equal(unknown.props['aria-valuenow'], undefined, 'Unknown is not represented as an exhausted account')
assert.equal(unknown.props.children.props.style.width, '100%', 'Unknown capacity shows a visible dim bar, not an empty gap')
assert.equal(unknown.props.children.props.style.opacity, 0.45)
assert.equal(unknown.props.children.props.style.background, 'var(--ui-text-tertiary)')

// Exhausted capacity: show the reset countdown as hh:mm.
const at = minutes => new Date(Date.now() + minutes * 60000 - 500).toISOString()
const wr = (label, percent, resets) => ({ label, percent, resets_at: resets })
const exhaustedCodex = { ...codex, windows: [wr('5h', 100, at(92)), wr('7d', 50, at(4000))] }
assert.equal(context.summary(exhaustedCodex), '0%')
assert.equal(context.resetTimer(exhaustedCodex), '01:32', 'Session-exhausted Codex counts down to the session reset')
assert.equal(context.resetTimer({ ...codex, windows: [wr('5h', 20, at(30)), wr('7d', 100, at(4215))] }), '70:15', 'Weekly block counts to the weekly reset')
assert.equal(context.resetTimer({ ...codex, windows: [wr('5h', 100, at(300)), wr('7d', 100, at(4215))] }), '70:15', 'Both exhausted waits for the later reset')
const weeklyOnly = { ...codex, windows: [wr('7d', 100, at(4215))] }
assert.equal(context.summary(weeklyOnly), '0%', 'Exhausted weekly alone is 0% even without session data')
assert.equal(context.resetTimer(weeklyOnly), '70:15')
assert.equal(context.resetTimer(codex), null, 'No timer while capacity remains')
assert.equal(context.resetTimer({ ...codex, windows: [wr('5h', 100, null)] }), null, 'Never invent a reset time')
assert.equal(context.resetTimer({ ...codex, windows: [wr('5h', 100, at(-5))] }), null, 'A reset in the past is not shown')
assert.equal(context.resetTimer({ ...codex, windows: [wr('5h', 100, 'not a date')] }), null)
const allBlocked = { id: 'anthropic', status: 'ok', windows: [
  wr('acct-a · 5h', 100, at(120)), wr('acct-b · 5h', 100, at(45)), wr('acct-c · 5h', 100, at(200))
] }
assert.equal(context.summary(allBlocked), '0%')
assert.equal(context.resetTimer(allBlocked), '00:45', 'Anthropic counts to the first account coming back')
assert.equal(context.resetTimer({ ...allBlocked, windows: allBlocked.windows.map((x, i) => i === 1 ? wr(x.label, 18, at(45)) : x) }), null, 'No timer while any account has capacity')
payload = { providers: [exhaustedCodex, allBlocked] }
const exhaustedBar = text(context.BarDetail())
assert.match(exhaustedBar, /Codex 0% · 01:32/)
assert.match(exhaustedBar, /Anthropic 0% · 00:45/)
assert.match(text(context.BarTip()), /Codex 0% remaining · resets in 01:32/)
const goWin = (...ws) => ({ id: 'opencode-go', name: 'OpenCode Go', status: 'ok', windows: ws })
assert.equal(context.summary(goWin(w('5h', 3), w('7d', 10), w('Monthly', 60))), '87%', '5h x weekly product, monthly ignored while it has room')
assert.equal(context.summary(goWin(w('5h', 3), w('7d', 10))), '87%', 'Missing monthly is not invented')
assert.equal(context.summary(goWin(w('5h', 3), w('7d', 10), w('Monthly', 100))), '0%', 'Exhausted monthly cap blocks everything')
assert.equal(context.summary(goWin(w('5h', 0), w('7d', 0), w('Monthly', 0))), '100%', 'All-zero use is full capacity')
assert.equal(context.summary(goWin()), '-', 'No windows stays unknown')
assert.equal(context.summary(goWin(w('5h', 100), w('7d', 10), w('Monthly', 20))), '0%', 'Any exhausted cap is 0%')
assert.equal(context.resetTimer(goWin(wr('5h', 20, at(30)), wr('7d', 20, at(100)), wr('Monthly', 100, at(2000)))), '33:20', 'Exhausted monthly counts to the monthly reset')
payload = { providers: [codex, anthropic] }
assert.doesNotMatch(text(context.BarDetail()), /\d\d:\d\d/, 'Healthy providers show no timer')

// Default (no pinned aliases): every answering account counts, shown as A1, A2, ...
pin({})
const solo = { id: 'anthropic', status: 'ok', windows: [w('5h', 20), w('7d', 50)] }
assert.equal(context.summary(solo), '40%', 'A single unlabelled account works without any pinning')
assert.deepEqual(Array.from(context.quotaAccounts(solo), a => a.label), ['A1'])
const pair = { id: 'anthropic', status: 'ok', windows: [w('one · 5h', 20), w('one · 7d', 50), w('two · 5h', 50), w('two · 7d', 20)] }
assert.equal(context.summary(pair), '40%', 'Two answering accounts are averaged: (40 + 40) / 2')
assert.deepEqual(Array.from(context.quotaAccounts(pair), a => a.label), ['A1', 'A2'])
assert.equal(context.summary({ id: 'anthropic', status: 'ok', windows: [] }), '-', 'No accounts stays unknown')
payload = { providers: [codex, pair] }
assert.doesNotMatch(text(context.UsagePanel()), /\bone\b|\btwo\b/, 'Raw account labels are never shown')
// Rate-limited provider: the last reading is labelled, never hidden.
payload = { providers: [{ ...codex, stale: true, fetched_at: '2030-01-01T10:15:00Z', hold_until: '2030-01-01T10:45:00Z' }] }
assert.match(text(context.UsagePanel()), /last reading .*retry after /, 'Stale provider shows when it was read and when it retries')
console.log('Compact provider usage assertions passed')
