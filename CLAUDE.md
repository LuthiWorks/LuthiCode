# CLAUDE.md - LuthiCode

@AGENTS.md

The file above holds the short rules shared with the local model. Everything below is for Claude sessions working on this repo.

## Project overview

LuthiCode is LuthiWorks' local coding agent: Qwen3.6-35B-A3B served by llama.cpp (Vulkan) on Brian's Windows PC, driven by the Pi harness, plus Pi extensions built here. It is meant to do bounded implementation work in **LuthiModel** and **Sanctuary**.

**Where to start, in this order:** `README.md` -> `docs/plan.md` -> `docs/decisions.md` (newest last) -> the newest file in `docs/research/`.

## Relationship to LuthiModel and Sanctuary

- The agent works inside those repos, and their own `CLAUDE.md` governs that work. Pi loads it automatically.
- LuthiCode never rewrites their rules. It enforces them where Pi would otherwise leave them unenforced.
- **Sanctuary's protected paths** (the entity's journals, memories and constitutional files) are guarded for Claude Code by `.claude/hooks/protect-paths.ps1`. That hook does not run under Pi, and Pi does not ask before file edits. LuthiCode's `protect-paths` extension is the only enforcement the local agent has. Any change to it needs tests and a review by a different mind (see below).
- **LuthiModel's checkpoints are irreproducible** and experiment artifacts are archived, never deleted. The guard covers those too.

## Model-line roles

Two rules carry over from the LuthiWorks repos:

1. Design and review are held by different minds, a different model family where possible.
2. The science and vision belong to Brian and the seats he designates.

Here that means:
- An extension written in one session is reviewed in another.
- The `protect-paths` guard gets a review from a different model family before the agent runs in Sanctuary unattended.
- The local agent's own seat is Brian's call; it is an open question in `docs/plan.md`.

## Fresh-instance audits

The protocol lives in Sanctuary at `docs/AUDIT_PROTOCOL.md`; read it before spawning one. Audits of this repo land in `docs/audits/`, one file per audit. Start with the safety extension and the eval runner, since a quietly wrong eval misdirects every decision after it.

## Build and test

- **Target machine:** Windows; RX 7800 XT (16 GB VRAM), 32 GB DDR4, Ryzen 9 5950X.
- **Claude sessions usually run on Linux** without the model. Test what can be tested here, and list what still needs a run on Brian's PC.
- **Runtime:** the llama.cpp Windows Vulkan release, Pi (`@earendil-works/pi-coding-agent`, Node 22.19+), and Git for Windows (Pi's shell tool uses Git Bash).
- **Extensions:** TypeScript, one file each, loaded by Pi with no build step. Each ships with tests that run without the model server.
- **Behavior:** judged by `eval/`. A change that only passes unit tests is unproven until it has been through the eval.
- **Pi docs:** they ship with the npm package, in `node_modules/@earendil-works/pi-coding-agent/docs/`, and are more current than most web pages about Pi.

## Eval rigor

Adapted from LuthiModel's standing rules:

1. **One change per comparison.** If two things change, add the arms that separate them.
2. **Matched baseline:** same tasks, same server settings, same repeat count.
3. **Measure the claim as stated.** An extension meant to cut failed edits is judged on failed edits, not only the pass rate.
4. **Report the spread across repeats**, not a single number.
5. **A task's check must fail before the agent runs.** A check that passes on the unmodified starting point measures nothing.

## Settled decisions: do not reinvent

The reasoning is in `docs/decisions.md`. Change these only with eval evidence:

- The model choice and its revisit conditions.
- Prompt-cache discipline: the system prompt and tool list never change mid-session, and `preserve_thinking` stays on even with thinking off.
- Thinking off by default.
- A `.bat` launcher, not PowerShell, because of JSON quoting.
- Pi, extended, as the harness.

## Conventions

- **Windows-first.** `.bat` files are CRLF and ASCII-only: cmd and PowerShell 5.1 misread UTF-8 without a BOM.
- **Public repo.**
  - Never commit secrets or user-home paths; use `%USERPROFILE%` and environment variables. A fixed default folder (like `C:\llama.cpp`) goes in a variable at the top of the script, so it's one edit to change.
  - Never commit model weights (`*.gguf`).
- **The GPU belongs to llama-server during agent sessions.** Anything the agent runs, tests included, stays on CPU.
- **Harness memory lives outside every repo**, never in a `.memories/` folder.
- **Third-party Pi packages run with full access.** Read the code before installing one, and record the version used.
- **The context window is set in two places** (the server script and `pi/models.json`). Change both together.

## Research log

Any session that involves iterative discovery, such as tuning against the eval, chasing a cache problem, or a result that contradicts expectations, gets a dated entry. Use `docs/research/YYYY-MM-DD_short-topic.md`, one file per entry, in the same structure as LuthiModel and Sanctuary:

```markdown
# [Topic] - [Date]

## Objective
## Process
### Step 1: [what you tried first]
### Step N: [as many steps as it took]
## Conclusion
## Artifacts
```

Document as you go, include the wrong turns, commit the entry with the change, and say what you don't know. Routine work needs no entry.

## What NOT to do

- Do not change the system prompt or tool list mid-session, including through `setActiveTools`.
- Do not add an extension without an eval comparison against the baseline.
- Do not weaken, narrow or bypass `protect-paths` to make a task pass.
- Do not let the agent push to any repo, or work anywhere but a throwaway worktree during evals.
- Do not run GPU workloads while the model server is up.
- Do not trust a benchmark score without checking how it was measured. Vendor numbers use vendor scaffolds.
