# Decisions

Newest at the bottom. Benchmark scores are vendor-reported unless noted.

## 2026-10-26 - Model: Qwen3.6-35B-A3B at UD-Q4_K_M

Hardware limit: 16 GB VRAM (RX 7800 XT), 32 GB DDR4-3000.

- **Rejected: Qwen3.6-27B dense** (77.2% SWE-bench Verified). Q4 weights are about 15.5 GB, so holding useful context needs a 24 GB card. Q3 fits, but users report it's noticeably worse for coding. Offloading dense layers to DDR4 is slow.
- **Chosen: Qwen3.6-35B-A3B** (73.4% SWE-bench Verified). Only 3B parameters are active per token, so expert weights can live in system RAM with little penalty. One user reported 33 tokens/s on the same GPU with 32 GB DDR5. DDR4-3000 has about 60% of that bandwidth, so expect about 20-25 tokens/s (estimate, unmeasured).
- **Revisit when Qwen 4 ships.** Alibaba announced a 27B open-weights model with no specs yet. If it's dense, it hits the same 16 GB wall.

## 2026-10-26 - Harness: Pi, extended rather than built from scratch

- Pi's core is four tools (read, write, edit, bash) and a system prompt under 1,000 tokens. Everything else is TypeScript extensions.
- Pi already provides optional grep, find and ls tools (enabled in `pi/settings.json`) and loads `AGENTS.md` automatically. That covers glob, list_dir, grep and the project file from the original spec.
- **Rejected: OpenCode.** It ships more built in, but its heavier default context works against a small model.
- On Windows, Pi's bash tool uses Git Bash. That suits Qwen, which writes Unix-style commands.

## 2026-10-26 - Prompt-cache discipline

With experts on the CPU, processing the prompt is the bottleneck, so a broken cache prefix means reprocessing the whole context every turn.

- Qwen's chat template renders tool schemas into the system prompt. **Never change the tool list mid-session.** `load_tools` must return schemas as a tool result.
- `preserve_thinking: true` is set on the server **even with thinking off**. One measurement showed cross-turn cache reuse at 0% without it and about 86% with it.
- `--no-mmproj` (no vision). With vision loaded, llama-server disables cache reuse.

## 2026-10-26 - Thinking off by default

- Speed: at about 20-25 tokens/s, reasoning tokens are expensive per turn.
- Known Pi + Qwen3.6 failure mode with thinking on: after 2-3 turns, tool calls arrive with empty arguments (Pi issue #3325). The server-side `preserve_thinking` default should prevent it, if llama.cpp merges per-request template settings with server defaults rather than replacing them. Unverified.
- `pi/models.json` defines a second model ID, `qwen3.6-35b-a3b-think`, that turns thinking on, so the eval can compare the two. In single-model mode llama-server ignores the model name, so both IDs use the same weights.

## 2026-10-26 - Sampling: presence_penalty 0

- This departs from Qwen's non-thinking preset (1.5). Qwen's own precise-coding preset uses 0, and penalizing repeated tokens works against code, which reuses identifiers constantly. The eval should confirm it.

## 2026-10-26 - Launcher is a .bat, not PowerShell

- Windows PowerShell 5.1 strips quotes from JSON passed to native programs, which would silently break `--chat-template-kwargs`. cmd passes the argument through intact.

## 2026-10-26 - Qwen3.8-27B added as a candidate

- Missed in the first pass. Qwen3.8-27B (August 2026, Apache 2.0) reports SWE-bench Pro 61.7 against Qwen3.6-27B's 53.5, and Terminal-Bench 2.1 73.0 against 63.4 (vendor numbers).
- It is a 27B dense model, so it faces the same 16 GB wall. It's a Phase 3 comparison in `docs/plan.md`, not a swap.
- There is no official Qwen3.8 MoE under about 180B total parameters; Qwen3.6-35B-A3B stays the MoE option.

## 2026-10-26 - AGENTS.md for the local model, CLAUDE.md for Claude

- Pi reads one context file per directory, first match in this order: `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md` (confirmed in Pi 1.4.0's source).
- Claude Code reads `CLAUDE.md` instead of `AGENTS.md` when both exist, and supports `@AGENTS.md` imports.
- So `AGENTS.md` holds the short shared rules, which is all the local model pays for each turn. `CLAUDE.md` imports it and adds the fuller guidance for Claude sessions.

## 2026-10-26 - Sanctuary's path protection must be rebuilt for Pi

- Sanctuary's protected-paths rule is enforced for Claude Code by a hook that Pi does not run.
- Pi also doesn't ask before file edits, which is why that hook only had to check shell commands.
- So a `protect-paths` Pi extension covering shell, write and edit comes before any agent run in Sanctuary (Phase 0 of `docs/plan.md`).

## 2026-10-26 - The local agent's seat: all seats, mainly implementation

- Brian's call: see what the local model can do in every seat, with implementation and coding as the main job.
- So the eval task set is about 70% implementation, with smaller debugging and review sets (`docs/plan.md`, Phase 1). Planning and research are scored by hand, later.

## 2026-10-26 - How the protect-paths guard decides

The full story is in `docs/research/2026-10-26_protect-paths-guard.md`.

- **Paths are resolved, not just pattern-matched.** Write/edit/shell targets are resolved the way Pi resolves them (Windows forms, `~`, `@`, `cd` within a command), then checked against the repo they land in. Sanctuary's token patterns stay as a second net.
- **Repos are recognized by their `pyproject.toml` name** (`sanctuary`, `luthi`), so eval worktrees under any folder name are protected too.
- **Deleting or moving a folder counts as touching everything in it.** The folder is scanned, failing closed past 20,000 entries; dependency folders like `node_modules` and `.venv` aren't scanned.
- **When the guard can't see a mutating command's targets, it blocks** (variables, xargs, wildcards it can't expand), but only in the protected repos.
- **Beyond Sanctuary's hook:** git commands that switch to or bring in other commits are blocked in Sanctuary, because they rewrite tracked entity data without naming it. Sanctuary's own `.claude/` guard and Pi's config folder are protected, so the agent can't disable either.
- **Accepted false positives:** copying or archiving from a protected folder, inline code that reads one, `find -delete` at a repo root, and plain branch switches in Sanctuary. In each case the agent is told to stop and ask.
- **Known gaps:** scripts the agent runs, paths built at runtime, symlinks, junctions, 8.3 short names, UNC paths, and deliberate obfuscation.
- **Installed by copying** into Pi's global extensions folder, so the guard applies in every repo. `install-config.bat` must be re-run after updates.

## 2026-10-26 - Everything outside the task's workspace is read-only

Brian's concern: the agent deleting the operating system "and things like that". A list of dangerous paths can never be complete, so the guard now works the other way round.

- **The workspace** is the git repo or worktree Pi was started in (found by walking up to `.git`), plus temp folders and the harness memory folder. The agent can't change anything else: not the OS, not other folders, not other repos, not the E: drive.
- **Too broad to count:** a drive root, a home folder, `C:\Users` or a system folder. If Pi is started in one of these, the agent can change nothing.
- **Extra folders** can be granted per session with `LUTHICODE_WORKSPACES` (`;`-separated). Protected files inside them stay protected.
- **Writes, not reads, are judged.** For copy-like commands only the destination counts, so `cp ~/.gitconfig ./sample` still works. For unknown commands only their redirects count.
- **Machine-level commands are blocked everywhere:**
  - shutdown and restart
  - disks, partitions and boot settings
  - the registry and machine-wide environment variables
  - services, scheduled tasks, accounts, permissions and Defender
  - global installs (winget, choco, `npm -g`, plain `pip`; `uv` stays allowed)
  - elevation (sudo, runas)
  - killing processes by name, which could hit the model server or a training run
  - Docker volume pruning, since volumes may hold Sanctuary's entity state
  - `git config --global` and removing WSL distributions
- **What this can't do:** see inside a script the agent runs. Two layers cover that gap:
  - **Never run Pi as administrator.** UAC then lets Windows itself refuse changes to system files.
  - **Run unattended evals in a container** with only the worktree mounted (`docs/plan.md`, Phase 1). Pi's own sandbox extension is macOS and Linux only, so on Windows the container is Docker.

## Sources

- Qwen3.6 27B vs 35B-A3B fit and speed: https://insiderllm.com/guides/qwen-3-6-local-ai-guide/
- 27B needs 24 GB at Q4: https://gpuprix.com/brazil/best-gpu-for-local-llm/qwen3.6-27b
- 27B Q3 coding quality reports: https://reddit.sentinel-team.org/posts/1sxomh1/snapshots/2026-05-02T03%3A06%3A21.60641Z
- 35B-A3B on RX 7800 XT: https://reddit.sentinel-team.org/posts/1w55db1/snapshots/2026-09-04T21%3A20%3A12.3645Z
- Qwen 4 status: https://www.yottalabs.ai/post/qwen-4-release-date-what-is-known-how-to-prepare-2026
- Pi overview: https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/
- Pi on Windows: https://pi.dev/docs/latest/windows
- Pi built-in tools and AGENTS.md: https://www.hascode.com/getting-started-with-pi-an-extensible-ai-agent-harness/
- preserve_thinking cache measurement: https://huggingface.co/plunderstruck/Qwopus3.6-27B-Coder-MTP-ROCmFP4-GGUF
- Vision disables cache reuse: https://huggingface.co/plunderstruck/Qwen3.6-27B-OBLITERATED-MTP-ROCmFP4-GGUF
- Empty tool arguments issue: https://github.com/earendil-works/pi/issues/3325
- Qwen sampling presets: https://unsloth.ai/docs/models/qwen3.6
- Qwen3.8 lineup: https://codersera.com/blog/qwen-3-8-model-lineup-2026/
- Qwen3.8-27B model card: https://huggingface.co/Qwen/Qwen3.8-27B
- Pi extension API (tool_call blocking, setActiveTools): https://cdn.jsdelivr.net/npm/@earendil-works/pi-coding-agent@0.80.2/docs/extensions.md
- Claude Code CLAUDE.md and AGENTS.md handling: https://code.claude.com/docs/en/memory
- lsp-pi package: https://cdn.jsdelivr.net/npm/lsp-pi@1.0.5/README.md
