const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../desktop/plugin.js'), 'utf8')
  .replace(/^import .* from .*\n/gm, '')
  .replace('export default {', 'globalThis.plugin = {')

function boot(initial = {}) {
  const values = { ...initial }
  const registrations = []
  const ctx = vm.createContext({
    STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
    atom(value) { return { get: () => value, set: next => { value = next }, listen() {} } },
    jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
    useQuery() {}, useQueryClient() {}, useValue() {}, useEffect() {}, useRef() {}, useState() {}
  })
  vm.runInContext(source + '\n globalThis.inspect = () => ({mode: $mode.get(), providers: $barProviders.get()});', ctx)
  ctx.plugin.register({
    storage: { get: (key, fallback) => key in values ? values[key] : fallback, set: (key, value) => { values[key] = value } },
    rest: async () => ({}), os: {}, register: item => registrations.push(item)
  })
  return { state: JSON.parse(JSON.stringify(ctx.inspect())), registrations }
}

const fresh = boot()
assert.equal(fresh.state.mode, 'remaining', 'New install must start in Remaining mode')
assert.deepEqual(fresh.state.providers, ['openai-codex', 'anthropic', 'opencode-go'], 'Only Codex, Anthropic and OpenCode Go must be visible')
assert.equal(fresh.registrations[0].area, 'statusBar.left', 'Provider usage belongs in the left cluster after core items including Cron')
assert.equal(fresh.registrations[0].data.variant, 'menu')
assert.equal(fresh.registrations[0].data.menuAlign, 'start', 'Left-side popup aligns with the widget')
const saved = boot({ valueMode: 'used', barProviders: ['anthropic'] })
assert.equal(saved.state.mode, 'used', 'Do not override future user preferences')
assert.deepEqual(saved.state.providers, ['openai-codex', 'anthropic', 'opencode-go'], 'The compact layout replaces old visibility settings')
console.log('7 Desktop setup assertions passed')
