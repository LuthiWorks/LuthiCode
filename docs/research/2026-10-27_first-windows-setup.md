# First setup on Brian's PC - 2026-10-27

## Objective

Bring LuthiCode up on the reference machine for the first time: README setup, then eval setup and the full gold replay. Everything before this was built and tested on Linux and in CI. The baseline waits for Brian's go-ahead after he sees the replay results.

## Process

### Step 1: installs (each approved by Brian)

- Node 24.22.1 (winget `OpenJS.NodeJS.LTS`)
- llama.cpp b11936, Vulkan x64 release, unzipped to `C:\llama.cpp`
- Pi 1.4.0 (`npm install -g --ignore-scripts`, the version CI pins)
- Already present: git 2.55, uv 0.11.32. No C++ compiler, so LuthiModel's C++ parity tests skip (expected; not installed).

### Step 2: GPU check

`node server\start-server.mjs --check` -> `Vulkan0: AMD Radeon RX 7800 XT (16368 MiB, 15401 MiB free)`. Driver 32.0.31041.1004.

### Step 3: guard

- `protect-paths.e2e.mjs`: 10/10 on Windows.
- Control (`E2E_NO_GUARD=1`): 4/10, failing exactly the six protection checks. The test discriminates.
- `run-tests.e2e.mjs`: 5/5. Unit tests: 53/53.

### Step 4: the server wouldn't start

- `error: invalid argument: --no-mmap`. llama.cpp replaced that flag with `--load-mode MODE`; `none` is the same behavior (no mmap, no mlock).
- Every other flag the launcher passes was checked against b11936's `--help` and exists.
- Fixed in `d1d2bc9` (launcher, its test, `server/README.md`).
- Also seen, not changed: `Setting 'enable_thinking' via --chat-template-kwargs is deprecated. Use --reasoning on / --reasoning off instead.` It still works. It touches the thinking-off and `preserve_thinking` cache decisions, and how Pi's `-think` model switches thinking per request, so it should be changed deliberately with a cache-reuse check, not as a side fix.

### Step 5: eval setup

`C:\LuthiCodeEval` (Brian's choice: NVMe, plenty of room). Both clones and environments built. LuthiModel: torch 2.10.0+cpu (setup installed the matching torchaudio 2.10.0, as designed). Sanctuary: torch 2.4.1+cpu on Python 3.12.13. Both smoke tests pass.

A slip of mine: I started `setup.mjs` once before `config.local.json` existed. It refused to run and wrote nothing, which is the behavior you want.

### Step 6: gold replay

- Quick replay: 2/2.
- Full replay (`luthimodel- sanctuary-`): **98/101 resolved**, in about 30 minutes rather than the 1-2 hours estimated.

The three that don't resolve on Windows:

| Task | Why |
|---|---|
| `sanctuary-61417141` | `test_symlink_inside_root_pointing_outside_denied` skips: creating symlinks on Windows needs Developer Mode or admin. Predicted in `eval/README.md`. |
| `sanctuary-db71caab` | Same test, same reason. |
| `luthimodel-3940aa39` | Pass-to-pass test `test_attractor_consolidation_reduces_weight_drift_vs_baseline` is `xfail(strict=False)`. It xpassed on Linux during validation; on Windows it xfails, deterministically (run twice with `--runxfail`: baseline_drift=3.1173, attractor_drift=3.3609 both times). CPU numerics differ between platforms, and the test's own docstring says its outcome is configuration-dependent. The scorer counts the xfail as "broke other tests". |

## Conclusion

- The harness works on the reference machine: GPU found, guard 10/10 with a discriminating control, eval setup clean, 98/101 replays resolved.
- Per `eval/README.md`, the three tasks above are left out of Windows runs; the tasks themselves are unchanged.
- **Not decided (for whoever designs the next eval change):**
  - There is no exclusion mechanism yet; leaving tasks out is manual (`--only`). A per-platform exclusion list, read by `run.mjs` and reported in the summary, would keep it honest.
  - A non-strict xfail test is allowed to go either way, so it arguably doesn't belong in a task's pass-to-pass set at all. Dropping such tests from pass-to-pass at mining time would put `luthimodel-3940aa39` back on Windows. This changes scoring, so it wants a review rather than a quiet edit.
  - Turning on Windows Developer Mode would let the symlink test run. It would also let the agent create symlinks, which are a known gap in the guard. I'd keep it off.
- **Not yet measured:** decode speed, cache reuse, tool arguments and `cpu_moe` tuning. The smoke test hasn't run; Brian is still weighing whether and how he'll use LuthiCode, so nothing is scheduled.

### Step 7: first model load

- The first load attempt was stopped by Claude Code's low-memory protection (it reaps background tasks it launched). Firefox, Discord and the Claude app were open. With those closed (23.6 GB free before start), the model loaded in about 16 seconds once downloaded, and `/health` returned ok.
- Loaded footprint: about 11 GB working set for llama-server (the CPU-side experts); 12.8 GB of 31.9 GB stayed free. `--load-mode none` is fine on 32 GB without heavy apps open; no launcher change.
- Starting the server from a Claude Code background shell is fragile for this reason. Brian starting `start-qwen-server.bat` himself isn't subject to it.
- Two log warnings, recorded, not acted on:
  - `cache_reuse is not supported by this context, it will be disabled`. Likely the model's architecture rules out llama.cpp's shifted-chunk reuse (`--cache-reuse`); plain prefix reuse between turns may still work. The smoke test should measure it, since the prompt-cache decisions assume reuse.
  - `security: no API key is set and CORS allows all origins`. The server listens on 127.0.0.1 only, but a page open in a local browser could still send it requests. Worth a deliberate fix (an API key in `server.json` and Pi's `models.json`, or restricting CORS).
- Asked its cutoff, the model said "2026". Qwen's card gives none (release: April 2026). Self-reports of cutoff aren't reliable either way.

## Artifacts

- `d1d2bc9`: `--load-mode none` fix
- `eval/config.local.json` (untracked): `work` = `C:\LuthiCodeEval`
- Replay output: `C:\LuthiCodeEval\runs\gold-replay-*`

## Follow-up, 2026-10-28

Both suggestions above were taken up the next day (see `docs/decisions.md`, 2026-10-28):
- The three Windows tasks are now listed in `eval/exclusions.json`. `run.mjs` leaves them out and names them in the summary; the replay still runs them and reports their failures as expected.
- The server now requires a key: one per machine, kept in Pi's agent folder rather than in `server.json`, since that file is tracked in a public repo. To pick it up on this PC, re-run `pi\install-config.bat`, restart the server, and run `node server\start-server.mjs --verify`.
