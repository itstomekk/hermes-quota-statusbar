# Development

This is a fork of [PhoeniXAbhisheK/hermes-plugin-provider-usage](https://github.com/PhoeniXAbhisheK/hermes-plugin-provider-usage).
Most of the backend is upstream's; the compact desktop layout is what this fork adds.

## Layout

| Path | What it is |
|---|---|
| `desktop/plugin.js` | Status-bar item and popover. Plain JS, no build step. Fork-specific. |
| `dashboard/plugin_api.py` | Backend: provider fetchers, cache, 429 holds. Upstream's, plus the Codex 0% fallback and multi-account Anthropic. |
| `scripts/install_local.py` | Optional installer for the desktop half, with backup and `--restore`. |
| `tests/` | `test_provider_usage.py` (upstream's, extended), plus the fork's `.py`, `.cjs` and `.mjs` tests. |
| `docs/` | `index.html` is the GitHub Pages landing page; `docs/img/` holds its screenshot. |
| `.github/readme/` | Screenshot used by the README. |

## Run the tests

```
python -m pytest tests
node tests/test_compact_usage.cjs
node tests/test_desktop_setup.cjs
node tests/test_update_protection.mjs
```

`test_update_protection.mjs` needs a local Hermes Desktop install that has this
plugin installed through `scripts/install_local.py`; it prints `SKIP` otherwise.

## Rules of thumb

- Providers read their keys from Hermes' secret scope, the profile `.env` or the
  provider's own CLI login at runtime. Never put a key, token, e-mail address or
  account id in the repo, in a test fixture or in a screenshot.
- Keep the desktop half dependency free: it is loaded as-is by Hermes Desktop.
- Test fixtures use made-up labels and fake tokens (`fx-a`, `acct-a`).
- Run the leak scan before every push (see [UPDATING.md](UPDATING.md)).
