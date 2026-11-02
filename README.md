> [!NOTE]
> **This is a fork.** It builds on
> [PhoeniXAbhisheK/hermes-plugin-provider-usage](https://github.com/PhoeniXAbhisheK/hermes-plugin-provider-usage)
> (MIT, original work by its authors), merged onto upstream `main` at v0.3.1.
> All the provider fetching, caching and rate-limit handling is theirs; this
> fork only changes how the Hermes Desktop status bar presents it, and adds a
> few backend fallbacks.
>
> What is different from upstream (checked against the diff):
>
> - **Status bar:** shows only Codex, Anthropic and OpenCode Go, always as
>   remaining capacity, each with a thin 3px meter (green above 50%, amber at
>   20 to 50%, red below 20%). Upstream shows the providers you pick with eye
>   toggles and offers a Used/Remaining switch; both are gone here.
> - **One number per provider:** weekly remaining x session remaining / 100.
>   Anthropic is the mean of that number across your accounts. OpenCode Go uses
>   the same product and drops to 0% when its monthly cap is used up.
> - **Placement:** the item sits in the left cluster, after Cron (upstream: right cluster).
> - **Exhausted countdown:** at 0% the bar adds an `hh:mm` countdown to the reset.
> - **Compact popover:** a Session / Weekly table with one row per account
>   (named A1, A2, ...), instead of upstream's dense per-window rows. An
>   account that does not answer stays visible and counts as 0%.
> - **Backend, Codex:** when every Codex login is rate limited, the card stays
>   at 0% with the reset time taken from Hermes' own credential pool record,
>   instead of disappearing.
> - **Backend, Anthropic:** every Hermes OAuth login is queried (plus a distinct
>   Claude Code login), with `7d Opus`, `7d Sonnet` and dollar-credit rows
>   when present; it reads `auth.json` directly if Hermes' pool loader fails.
> - **Left out on purpose:** native desktop notifications and burn-rate
>   projections in the UI. The other providers (OpenRouter, Copilot, Nous, Z.AI,
>   Kimi, MiniMax, DeepSeek) are still fetched by the backend but not drawn.
> - **Extras:** `scripts/install_local.py` (install with a backup you can
>   restore), more tests, and these docs.

<p align="center">
  <img src=".github/readme/quota-bar.png" alt="Hermes Desktop status bar showing Codex 68%, Anthropic 16% and OpenCode 91% remaining, each with a thin meter underneath" width="100%">
</p>

# 📊 Hermes Quota Status Bar

Ever hit a usage limit halfway through a task? This puts the answer in the
Hermes Desktop status bar: one glanceable number for how much of your
**Codex**, **Anthropic** and **OpenCode Go** quota you still have left.

[Upstream project](https://github.com/PhoeniXAbhisheK/hermes-plugin-provider-usage) ·
[This repo](https://github.com/itstomekk/hermes-quota-statusbar) ·
[Landing page](https://itstomekk.github.io/hermes-quota-statusbar/) ·
[Hermes docs](https://hermes-agent.nousresearch.com/docs)

## ✨ What you get

- **Status bar:** `Codex 68% · Anthropic 16% · OpenCode 91%`, always the share
  you have left. The number is session remaining x weekly remaining / 100, so
  a nearly empty week shows up even when the 5-hour window looks fine. If a
  window has no weekly data, the session value is used on its own.
- **Meters:** a thin bar under each name, green above 50%, amber from 20 to
  50%, red below 20%. Unknown capacity gets a dim bar, so a slot never looks
  empty by accident.
- **Countdown:** at 0% the bar adds the time until it resets, as `hh:mm`.
- **Popover** (click the item): Session and Weekly columns with reset times,
  one row per Anthropic account. A refresh button and an auto refresh picker
  (30s, 1m, 5m, 10m) sit at the bottom.
- **Rate limits:** inherited from upstream. A provider that answers `429` with
  `retry-after` is paused until then, and the popover keeps the last reading
  with `last reading, retry after HH:MM` instead of hiding the provider.

## 🚀 Install

Hermes Desktop on Windows is what this fork was built and checked on.

1. **Python half** (same as upstream): clone this repository into
   `$HERMES_HOME/plugins/provider-usage/` (`~/.hermes/plugins/provider-usage/`
   by default), then run `hermes plugins enable provider-usage`.
2. **Desktop half:** copy `desktop/plugin.js` to
   `%LOCALAPPDATA%\hermes\desktop-plugins\provider-usage\plugin.js`.
3. In Hermes Desktop press **Ctrl+K**, then choose **Reload desktop plugins**.

The item appears in the left cluster after Cron. Requires a Hermes build with
the desktop plugin SDK (`>=0.21.0`).

Prefer a script? `python scripts/install_local.py` does step 2 for you, keeps a
checksummed backup, and `--restore <backup folder>` puts it back. It adds a
one-line "local override" header so Hermes keeps your file instead of
re-copying the package version; that behaviour was only checked on the
author's machine.

### Several Anthropic accounts

By default every signed-in account that answers is shown as A1, A2, ... and
averaged. To pin names (so an account that is temporarily rate limited keeps its
row and counts as 0%), edit `ACCOUNT_ALIASES` near the top of `desktop/plugin.js`:
`{ 'work': 'A1', 'personal': 'A2' }`, where the keys are the account labels in
your Hermes credential pool.

## 🧭 Limits, in plain words

- The status bar shows only Codex, Anthropic and OpenCode Go. The backend still
  reads the other providers, but this widget does not draw them. Want them
  back? Use upstream.
- It always shows remaining capacity. There is no Used mode.
- No desktop notifications and no burn-rate projections in this layout.
- The Anthropic numbers come from an unofficial usage endpoint that upstream
  uses; if Anthropic changes it, that card can go blank until upstream or this
  fork catches up.
- If you pin account names and one account stops answering, the average treats
  it as 0%. That is deliberate, but it can look alarming.
- Tested on Windows only. macOS and Linux paths follow upstream and were not tried here.
- Nothing is written to any credential file and no keys are stored in this
  repository; the backend reads them from Hermes (or the provider's own CLI
  login) when it runs.

## 🖼️ Upstream screenshots

These show the upstream widget, not this fork's compact layout.

![Provider Usage panel](media/panel.png)

![Status bar](media/status-bar.png)

![Near-limit alert](media/notification.png)

## Providers and what it reads

| Provider | Credential (read-only) | Endpoint |
|---|---|---|
| OpenCode Go | `OPENCODE_GO_API_KEY` via the Hermes secret scope, else the `opencode-go` entry of `~/.local/share/opencode/auth.json` (never the Zen key; without a Go plan the card stays hidden) | `https://opencode.ai/zen/go/v1/usage` |
| OpenAI Codex | Hermes' Codex sign-in (account-usage helper), else `~/.codex/auth.json` | `https://chatgpt.com/backend-api/wham/usage` |
| OpenRouter | `OPENROUTER_API_KEY` via the Hermes secret scope | `https://openrouter.ai/api/v1/key`, `https://openrouter.ai/api/v1/credits` |
| Anthropic | Hermes' Claude Code sign-in (account-usage helper), else the Claude Code OAuth token in `~/.claude/.credentials.json`; a refused helper read keeps the last reading for up to six hours, marked stale | `https://api.anthropic.com/api/oauth/usage` |
| GitHub Copilot | Hermes' Copilot token resolver | `https://api.github.com/copilot_internal/user` |
| Nous | Hermes' Nous Portal sign-in | Nous Portal account info (subscription windows, else the credit balance as money rows) |
| Z.AI / GLM | `ZAI_API_KEY` or `GLM_API_KEY` | `https://api.z.ai/api/monitor/usage/quota/limit` |
| Kimi | `KIMI_API_KEY` or `MOONSHOT_API_KEY` | `https://api.kimi.com/coding/v1/usages` (falls back to the Moonshot balance: `api.moonshot.ai` first, then `api.moonshot.cn`) |
| MiniMax | `MINIMAX_CN_API_KEY` (mainland) or `MINIMAX_API_KEY` (global); the CN key is tried first and both are probed when both are set, since M Plan subscription keys are region-bound | `https://api.minimaxi.com/v1/token_plan/remains` for mainland, `https://api.minimax.io/v1/token_plan/remains` for global |
| DeepSeek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/user/balance` |

OpenCode Zen (the metered API) is not tracked yet; this card covers the Go subscription.

## Privacy

- **Read-only credentials.** The plugin writes nothing back to any credential
  file and never mints or refreshes a token itself. No browser cookies, no
  credential CLIs. Providers marked as resolved by Hermes use the app's own
  account-usage helpers (the same code path as Hermes' `/usage` surfaces,
  including Hermes' normal credential upkeep).
- **No subprocesses.** Every provider call is an in-process `httpx` request;
  nothing is shelled out, and no helper process ever sees a credential.
- **Client identity disclosure.** The GitHub Copilot check queries GitHub's
  internal Copilot usage endpoint presenting the VS Code / Copilot client
  identity (`Editor-Version`, `User-Agent`), the same identity the Copilot
  editor plugin presents.
- **All provider calls happen on your machine**, from the plugin's own backend
  half. The only network peers are the provider endpoints listed above.
- **No telemetry, no analytics, no self-updater.**
- The desktop half talks only to your own Hermes backend at
  `/api/plugins/provider-usage/`.

## Upstream install notes

Once listed, install from the plugin catalog:

```
hermes plugins install provider-usage
```

Until then, install manually:

1. Clone this repository into `$HERMES_HOME/plugins/provider-usage/`
   (`~/.hermes/plugins/provider-usage/` by default).
2. Enable it: `hermes plugins enable provider-usage`.
3. Reload the desktop app. Upstream's item appears in the right cluster; this
   fork's `desktop/plugin.js` uses the left cluster (see the install steps above).

Requires a Hermes build with the desktop plugin SDK (`>=0.21.0`).

## Notes on projections

Projections need at least 30 minutes of observed history inside the last 6
hours. The backend samples history in memory whenever it refreshes; a restart
pauses projections until samples reaccumulate. The payload carries
`eta_seconds` on windows and `depletes_in_seconds` on money rows, and the UI
only surfaces them when they are actionable (window hits 100% before its
reset; cap depletes within 14 days).

## Layout

```
plugin.yaml              Agent manifest
__init__.py              Agent entry point (inert by design)
dashboard/manifest.json  Dashboard manifest (mounts the backend router)
dashboard/plugin_api.py  Backend: fetchers, cache, burn-rate history
desktop/plugin.js        Desktop: status-bar item, popover, alerts
tests/                   Backend tests (pytest) and desktop tests (node)
scripts/install_local.py Optional desktop installer with backup and restore
docs/                    Landing page for GitHub Pages
```

## Development

- `hermes plugins validate .` runs the same admission checks as the catalog CI.
- `python -m pytest tests` runs the backend suite; `node tests/test_compact_usage.cjs`, `node tests/test_desktop_setup.cjs` and `node tests/test_update_protection.mjs` run the desktop ones. More in [DEVELOPMENT.md](DEVELOPMENT.md).
- The backend served payload is a single JSON object:
  `{ fetched_at, providers: [{ id, name, tag, status, windows | money }] }`.

## License

MIT, kept from upstream. Original work by its authors; this fork adds a second copyright line.
To update this fork from upstream, see [UPDATING.md](UPDATING.md).
