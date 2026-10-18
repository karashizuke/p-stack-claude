# pstack for Claude Code (personal fork)

A personal fork of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan ([poteto](https://x.com/poteto)), maintained for Claude Code.

Upstream already publishes a Claude Code build of pstack at [`harness/pstack/claude-code`](https://github.com/cursor/plugins/tree/main/harness/pstack/claude-code). This repo tracks that build and layers my own changes on top.

- Upstream documentation: [README.upstream.md](./README.upstream.md)
- Synced upstream commit: [UPSTREAM_COMMIT](./UPSTREAM_COMMIT)

## Install

From a local checkout:

```
/plugin marketplace add /Users/hosoi/github/karashizuke/p-stack-claude
/plugin install pstack@karashizuke-pstack
```

From GitHub, after you push this repo:

```
/plugin marketplace add karashizuke/p-stack-claude
/plugin install pstack@karashizuke-pstack
```

Uninstall any other `pstack` plugin first, such as `pstack@cursor-plugins`. Each one uses the plugin name `pstack`, so their skills conflict.

The plugin name stays `pstack` on purpose. The skills refer to each other as `pstack:<name>`, so renaming the plugin breaks those references.

## Branches

| Branch | Contents | Edit by hand? |
| --- | --- | --- |
| `upstream` | An exact copy of `harness/pstack/claude-code`. `README.md` is renamed to `README.upstream.md`, and `UPSTREAM_COMMIT` holds the upstream SHA. | No. Only `scripts/sync-upstream.sh` writes it. |
| `main` | `upstream`, plus this README, the marketplace file, the sync script, and my local modifications. | Yes. |

## Sync with upstream

```bash
scripts/sync-upstream.sh   # commits the latest upstream tree to the `upstream` branch
git merge upstream         # on main; resolve conflicts if any
git push origin main upstream
```

Then run `/plugin marketplace update karashizuke-pstack` in Claude Code, or turn on auto-update for this marketplace.

The script exits with no commit when upstream has not changed.

## Making changes

- To keep merges clean, add new files, such as new skills under `skills/`, instead of editing upstream files.
- When you must edit an upstream file, record it in the table below so you can review it during a merge.
- Do not bump `version` in `plugin.json` on `main`. Upstream bumps it on almost every release, so a local bump conflicts on every sync.

## Local modifications

| File | Change | Why |
| --- | --- | --- |
| `hooks/hooks.json`, `hooks/session-start-context.md` | Added. A `SessionStart` hook that injects routing rules into each session: use `pstack:poteto-mode` for multi-file, design, or unknown-cause tasks. | The upstream Claude Code tree has no hooks, so nothing tells the agent to use pstack. The text comes from [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude) (MIT). |
| `skills/setup-pstack/SKILL.md` (step 5) | The panel defaults are `opus xhigh, fable xhigh`, with `sonnet xhigh` added to `interrogate reviewers`. | In Claude Code the upstream `grok-4.7-xhigh-fast` panel seat becomes the parent model, so the panel ran Opus twice. Haiku never helped and Sonnet design candidates were never picked. |

## License

MIT, same as upstream. See [LICENSE](./LICENSE). All original work is by Lauren Tan and the cursor/plugins contributors.
