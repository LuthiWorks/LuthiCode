# Build plan

Written 2026-10-26. Targets: **LuthiModel** and **Sanctuary**. LuthiScope is not targeted yet.

## What the targets need

Surveyed from both repos on 2026-10-26.

| | LuthiModel | Sanctuary |
|---|---|---|
| Language | Python, ~73K lines | Python, ~91K lines |
| Tests | 104 test files under `tests/` | 124 test files under `sanctuary/tests/` and `sanctuary/mind/tests/` |
| Test command | `uv run python -m pytest tests/` | `uv run pytest` (CI runs a subset, see below) |
| Python | 3.11+ | 3.10 (DirectML stack) |
| Context file | `CLAUDE.md`, about 14 KB | `CLAUDE.md`, about 14 KB |
| Past commits touching source and tests (last 400) | 78 | 98 |

What follows from that:

- **Python only, for now.** `SanctuaryWorld/` (Godot) is empty, awaiting a rebuild. GDScript support waits until there is GDScript.
- **Each repo has its own environment.** Tests run through `uv run` inside the repo, never a shared interpreter.
- **LuthiModel has a known CPU failure.** On CPU, `LUTHI_ALLOW_CPU=1` is required, and one test in `tests/test_backend_declaration.py` fails by design. A test runner that reports raw failures would blame the agent for it.
- **Sanctuary's CI subset** is `-m "not benchmark and not integration and not property"`, ignoring `integration/`, `benchmarks/` and `property_tests/`, with `--timeout=30`. That is the sensible default for agent runs.
- **The GPU is shared.** llama-server holds about 14-15 GB of the 16 GB while the agent runs. Tests the agent starts must stay on CPU, or they will fight the server for VRAM.
- **Pi loads each repo's CLAUDE.md automatically**, about 3,500 tokens each. Pi reads one context file per directory, in the order `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`. That is acceptable to start with; the eval will show whether a shorter brief helps.

### Sanctuary's protected paths are unprotected under Pi

Sanctuary's `CLAUDE.md` forbids modifying the entity's data: `sanctuary/data/`, `.memories/`, `data/`, anything named `constitutional`, `charter`, `rights` or `sovereignty`, and journal-like JSON. For Claude Code, a deny-hook (`.claude/hooks/protect-paths.ps1`) backs that rule in code.

That hook does not run under Pi. It also only checks shell commands, because Claude Code asks before every file edit. **Pi does not ask before edits.** Run in Sanctuary today, the local agent would have only the written rule to stop it. A small model is more likely than Claude to misread one.

So the guard comes first, before the agent ever runs in Sanctuary.

## Build order

### Phase 0: safety, before the agent touches Sanctuary

**Status (2026-10-26):** items 1-3 built and tested on Linux. Still needed: a run of `extensions/tests/protect-paths.e2e.mjs` on Windows, and the cross-family review in `docs/reviews/2026-10-26_protect-paths.md`.

1. **`protect-paths` extension.** Port Sanctuary's rules to a Pi `tool_call` handler that returns `{ block: true, reason }`. Cover `bash`, `write` and `edit`, not just the shell.
   - Scope the Sanctuary rules to the Sanctuary repo. LuthiModel also has a `data/` folder, and the rules shouldn't misfire there.
   - Add LuthiModel's own rules: never delete checkpoints (`*.luthi`) or anything under `runs/`. Those checkpoints are irreproducible.
2. **Tests for the guard** that run without the model server: a table of commands and edits that must be blocked, and ones that must be allowed.
3. **Global brief for the local agent** at `%USERPROFILE%\.pi\agent\AGENTS.md`, installed by `pi/install-config.bat`. Short cross-repo rules: how to run tests, stay on CPU, and stop and ask near protected paths.

### Phase 1: first run and baseline

**Status (2026-10-27):**
- Built and tested on Linux with a scripted model:
  - the runner (item 2), without the Docker layer yet
  - the implementation and debugging task sets (item 3): 101 tasks, every one with an instruction
    - standard tier: LuthiModel 38, Sanctuary 26
    - large tier: LuthiModel 25, Sanctuary 12
  - gold replays: all 101 real fixes resolve through Pi and the guard (`eval/build/validation.md`)
- Not built yet: review tasks, safety tasks (item 4, draft design in `docs/safety-tasks.md`) and the container.
- Waiting on Brian's PC: the smoke test, `eval/setup.mjs`, and the baseline.

Details: `eval/README.md`, `docs/research/2026-10-26_eval-build.md`.

1. **Smoke test** on Brian's PC: decode speed, cache reuse, tool arguments, and `CPU_MOE` tuning.
2. **Eval runner.** For each task:
   - create a fresh git worktree at the task's commit
   - run Pi unattended
   - run the check
   - record pass/fail, time, tokens, tool calls and the failure type.

   The agent never pushes, and worktrees are thrown away afterward. Unattended runs happen in a Docker container with only the worktree mounted: the guard can't see inside scripts the agent runs, and a container can. The model server stays on the host.
3. **Task set v1:** about 20 tasks per repo. The local agent is tried in every seat, but implementation is the main job, so the mix leans that way:
   - **Implementation, about 14 per repo.** Mined from past commits that changed both source and tests. Each task reverts the source change, keeps the tests, and states the goal in plain words. The check is that those tests pass with no new failures in the repo's suite. Prefer small commits; a 35B model with 3B active won't do multi-day refactors.
   - **Debugging, about 3 per repo.** The same kind of commit, but the agent gets only the failing test output, with no description of the fix.
   - **Review, about 3 per repo.** A diff with a known bug, taken from history where a later commit fixed it. The check is whether the review names the bug and where it is. Scored by a different model family against the known answer, since that can't be checked by a test.
   - Planning and research seats come later, scored by hand. They're the hardest to grade automatically and the least central.
4. **Safety tasks:** a few Sanctuary tasks whose obvious "fix" touches a protected path. They pass only if the agent stops or the guard blocks it. They count separately and never average into a seat's score. Draft design: `docs/safety-tasks.md`.
5. **Baseline:** stock Pi plus the guard, every task run 3 times.

### Phase 2: extensions, in eval order

Each extension is added on its own, the eval re-run, and the result written to `eval/results/`. Provisional order:

1. **`run_tests`.**
   - Wraps each repo's own test command.
   - Forces CPU: `LUTHI_ALLOW_CPU=1`, and hides the GPU from ROCm. Confirm on the first run.
   - Applies a timeout.
   - Compares against a pre-task baseline, so failures that already existed aren't blamed on the agent.
   - Returns only the failures, truncated.
2. **`todo`:** a plan and checklist that keeps long tasks on track.
3. **LSP diagnostics.**
   - Try the existing `lsp-pi` package (pyright) before building one. It adds one tool and reports diagnostics for touched files at the end of each response.
   - Read its code before installing: Pi packages run with full access to the machine.
4. **`load_tools`.**
   - Only once there are enough extended tools to justify it.
   - Must not change the tool list mid-session, including through Pi's `setActiveTools`. Changing the list forces a full reprocess of the context.
   - Schemas arrive as a tool result, and calls go through a stable dispatcher.
5. **Memory (`memory_write` / `memory_search`).**
   - Notes live outside every repo, under `%USERPROFILE%\.pi\agent\memory\`.
   - Never `.memories/`: that is Sanctuary's protected entity store.
   - Searched with grep first; an embedding model comes later, only if grep falls short.
6. **`web_fetch`:** last; the targets rarely need the web.

### Phase 3: model and settings comparisons

Same task set, one change at a time:

- **Qwen3.8-27B** (August 2026, Apache 2.0). Vendor-reported scores are well above Qwen3.6-27B: SWE-bench Pro 61.7 vs 53.5, and Terminal-Bench 2.1 73.0 vs 63.4. It is a 27B dense model, though, so on 16 GB it needs an IQ3/IQ4-class quant and a shorter context. Whether a stronger model at lower precision beats the current one is exactly what the eval is for.
- **Thinking on vs off** (the `-think` model entry).
- **`presence_penalty` 0 vs 1.5.**
- **Qwen 4** when it ships.

## Eval rules

Adapted from LuthiModel's standing rules for rigor:

1. **One change per comparison.** If two things change, add the arms that separate them.
2. **Matched baseline:** same tasks, same server settings, same repeat count.
3. **Measure the claim as stated.** An extension meant to reduce failed edits is judged on failed edits, not only the pass rate.
4. **Report the spread across repeats**, not a single number.

## Open questions for Brian

1. ~~What seat does the local agent hold?~~ Answered 2026-10-26: tried in all seats, primarily implementation and coding. The task mix above reflects that.
2. ~~Commits in target repos?~~ Answered 2026-10-27: the agent commits its work to whatever repo it belongs to, new projects included, and never pushes. See `docs/decisions.md`.
3. ~~How would fine-tuning teach the agent?~~ Answered 2026-10-27: by demonstration only, if it ever happens. See `docs/decisions.md`.
