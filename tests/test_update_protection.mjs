import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// This test exercises the REAL Hermes Desktop reconciliation code against a locally
// installed override, so it only runs on a machine that has both. Elsewhere it skips.
const home = process.env.HERMES_HOME || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'hermes') : '')
const reconcile = home && path.join(home, 'hermes-agent/apps/desktop/electron/desktop-plugins-root.ts')
const installedPath = home && path.join(home, 'desktop-plugins/provider-usage/plugin.js')
const exists = p => p && fs.access(p).then(() => true, () => false)
if (!(await exists(reconcile)) || !(await exists(installedPath)) || !(await exists(path.join(home, 'plugins/provider-usage/desktop/plugin.js')))) {
  console.log('SKIP: no local Hermes Desktop install with this override found')
  process.exit(0)
}
const { materializeDesktopHalf } = await import(pathToFileURL(reconcile))
const installed = await fs.readFile(path.join(home, 'desktop-plugins/provider-usage/plugin.js'))
const scratch = path.join(home, 'cache/scratch')
await fs.mkdir(scratch, { recursive: true })
const root = await fs.mkdtemp(path.join(scratch, 'usage-update-test-'))
try {
  const pkg = path.join(root, 'plugins/provider-usage')
  const source = path.join(pkg, 'desktop')
  const target = path.join(root, 'desktop-plugins/provider-usage')
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(source, 'plugin.js'), 'export default { id: "provider-usage", name: "upstream" };')
  await fs.writeFile(path.join(target, 'plugin.js'), installed)
  // Reproduce the CURRENT runtime's management state, not a hypothetical one.
  const markerPath = path.join(home, 'desktop-plugins/provider-usage/.hermes-package.json')
  try {
    await fs.access(markerPath)
    await fs.writeFile(path.join(target, '.hermes-package.json'), JSON.stringify({ package: 'provider-usage', source, sourceMtimeMs: 0 }))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  assert.equal(await materializeDesktopHalf(pkg, path.dirname(target)), null, 'Startup must not replace the local UI')
  assert.deepEqual(await fs.readFile(path.join(target, 'plugin.js')), installed)
  await fs.writeFile(path.join(source, 'plugin.js'), 'export default { id: "provider-usage", name: "NEW upstream" };')
  assert.equal(await materializeDesktopHalf(pkg, path.dirname(target)), null, 'An updated upstream desktop half must not replace the local UI')
  assert.deepEqual(await fs.readFile(path.join(target, 'plugin.js')), installed)
  const body = await fs.readFile(path.join(home, 'plugins/provider-usage/desktop/plugin.js'))
  assert.deepEqual(installed, Buffer.concat([Buffer.from('// User-local Provider Usage override. Keep standalone; do not adopt as a package copy.\n'), body]), 'Installed header/body parity')
  console.log('Real Electron reconciliation preserved the local UI across startup and simulated upstream update')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
