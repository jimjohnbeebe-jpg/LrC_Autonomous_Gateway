---
document_type: environment_check
project: LrC_Autonomous_Gateway
authored_by: Claude Code (Opus 5.5), Phase 0 session 2026-09-23
---

# MCP availability — Phase 0, Step A

> Written by Claude Code in the Phase 0 session of 2026-09-23. Every statement below is backed by the command output quoted with it.

## 1. MCP servers attached to this Claude Code session

Handle: `claude mcp list` run from `D:\Developer\LrC_Autonomous_Gateway` on 2026-09-23. The output is abridged: nine `claude.ai …` account-connector lines are omitted for privacy (this repo is public). None of them is a Graphify or filesystem server.

```
[9 × claude.ai <connector>: https://… - ✔ Connected | ! Needs authentication — redacted]
plugin:desktop-commander:desktop-commander: npx -y @wonderwhy-er/desktop-commander@latest - ✔ Connected
```

- **No Graphify MCP server is attached to Claude Code**, and no `filesystem` MCP server either.
- **Filesystem access: confirmed** through Claude Code's built-in tools (Read/Write/Edit/Glob/Grep/Bash): this session read the vault at `C:\Users\jimbe\Documents\Obsidian Vault\Projects\LrC_Autonomous_Gateway\` and wrote under `D:\Developer\LrC_Autonomous_Gateway\`. The `desktop-commander` plugin server also exposes filesystem tools.

## 2. Claude Desktop MCP servers (for reference; not visible to Claude Code)

Handle: `mcpServers` in `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` (read 2026-09-23; env values not printed):

```
filesystem           npx -y @modelcontextprotocol/server-filesystem D:\ C:\Users\jimbe\
github               D:\Developer\Github_Server\github-mcp-server.exe stdio   (env: GITHUB_PERSONAL_ACCESS_TOKEN)
graphify-autodocweb  C:\Python314\python.exe -m graphify.serve D:/Developer/WebSites/AutoDocWeb/graphify-out/graph.json
```

`graphify-autodocweb` is a **Claude Desktop** server that serves one fixed file, AutoDocWeb's `graph.json`. It cannot index this repo and Claude Code cannot reach it.

## 3. Graphify status for this repo: per-repo graph CREATED

The Graphify CLI is installed and can build a separate graph for any folder:

- `uv tool list` → `graphifyy v0.9.15` (executables `graphify`, `graphify-mcp`); interpreter `C:\Users\jimbe\AppData\Roaming\uv\tools\graphifyy\Scripts\python.exe`. The Claude Code skill `~/.claude/skills/graphify/.graphify_version` = `0.9.15`.
- Language support (checked in the installed package): `graphify.detect` lists `.lua`, `.ts`, `.mjs`; `tree_sitter_lua` and `tree_sitter_typescript` are importable → Lua and TypeScript get AST extraction.

**Build (after Step B, as the directive says):** `/graphify D:\Developer\LrC_Autonomous_Gateway --no-viz`, run 2026-09-23.
- Corpus: 95 files, ~57.8k words — 75 code, 20 docs (0 papers/images/video). The `.gitignore` is honoured: `vendor/automaat/**/*.py` was not picked up.
- AST: 535 nodes / 927 edges. Semantic (1 Sonnet subagent over the 20 docs): 71 nodes / 93 edges / 3 hyperedges, 148,792 tokens total (the in/out split was not reported).
- Result: **606 nodes, 933 edges, 36 communities** → `graphify-out\graph.json`, `graphify-out\GRAPH_REPORT.md`.
- **Health warning (graphify's own check):** `87 dangling-endpoint edges; 2 collapsed (undirected) edges`. The graph is usable, but some edges point at nodes that are not in it.
- Quality caveats seen: semantic (LLM-extracted) node labels can overstate sourcing — one node calls Automaat's "plugin presets are hidden from the Develop panel" an "Adobe SDK design", which the survey tags **[upstream claim]**; and at least one phantom cross-file edge (`isPluginInstalledAnywhere() --indirect_call--> p()` from `install-plugin.ts` to `bump-version.mjs`). **Treat graph answers as pointers into the code, never as sourced facts.** `docs\AUTOMAAT_SURVEY.md` is the sourced record.
- `graphify-out\` is gitignored: it is derived, machine-local output.

**Working query (handle):** `graphify query "How does the plugin dispatch a socket request to a Lua handler and send the response?" --budget 600` → BFS from `sendResponse()`, `PluginSocket`, `Dispatcher`, `PluginInfoProvider.lua`…, 198 nodes found (output in the Phase 0 transcript).

**How to use it from now on (Claude Code):**
- Structural question → `graphify query "<question>"` (or `graphify path "A" "B"`, `graphify explain "X"`) from the repo root, *before* grepping.
- After code changes → `graphify update .` (AST only, no LLM, no tokens). Docs changes need a full `/graphify .` rebuild to be semantically extracted.

## 4. Decisions left for Jim (not blocking)

1. **Python tooling vs the stack rule.** Graphify is a Python package run through uv. My reading is that the rule "No Python anywhere, including tooling scripts" covers code in this repo and scripts we write, not a developer tool you already run outside the repo (the same as `graphify-autodocweb`). Nothing Python is committed: `graphify-out\` is gitignored, and the vendored `.py` files are excluded. If you read the rule more strictly, the fix is to delete `graphify-out\` and fall back to grep.
2. **MCP registration (not done).** The graph can also be exposed as an MCP server, the same way `graphify-autodocweb` is. For Claude Code that would be, for example, `claude mcp add graphify-lrcavg -- "C:\Users\jimbe\AppData\Roaming\uv\tools\graphifyy\Scripts\python.exe" -m graphify.serve "D:/Developer/LrC_Autonomous_Gateway/graphify-out/graph.json"`. It changes your Claude config and only takes effect in a new session, so I have not run it. The CLI route above works now.
