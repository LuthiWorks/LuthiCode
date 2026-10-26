# Building the eval - 2026-10-26

## Objective

Build the Phase 1 eval: tasks drawn from LuthiModel's and Sanctuary's real history, and a runner that runs the local agent on them unattended and scores the result. The aim is that every later harness change, setting or model swap gets judged by results rather than intuition (`docs/plan.md`).

## Process

### Step 1: mine candidates

- Every non-merge commit that changed source and tests together and touched no protected file, with 3-150 source lines in at most 3 files.
- LuthiModel: 44 candidates. Sanctuary: 20, widened to 33 (up to 300 lines, 4 files) because its history has fewer small commits.

### Step 2: environments

- Both repos' `uv.lock` files were installed into CPU-only environments, outside the clones.
- **LuthiModel's lockfile pairs torch 2.10.0 with torchaudio 2.11.0**, which is built for torch 2.11. On Linux its extension failed to load (it wanted CUDA 13 libraries), so every LuthiModel test file errored at import and the first two candidates were "rejected" for the environment's fault, not theirs. Installing torchaudio 2.10.0 fixed it.
  - `eval/setup.mjs` now detects a torch/torchaudio mismatch and installs the matching torchaudio.
  - Whether this mismatch also breaks Brian's Windows install is unknown. It's worth a look in LuthiModel itself, but it isn't changed from here.
- Sanctuary needs the PortAudio system library on Linux (its CI installs it). On Windows the wheel bundles it.

### Step 3: the runner, proven with a scripted model

- `eval/run.mjs` makes a worktree per attempt, runs Pi unattended with only the named extensions, then puts the commit's tests in place and runs them.
- `eval/tests/runner.e2e.mjs` builds a tiny repo and runs the runner four ways with a fake model: gold fix, no-op, a write blocked by the guard, and the debugging seat.
- Two wrong turns along the way:
  - **The first run hung forever.** The test called the runner synchronously, which froze the fake model server living in the same process, so Pi waited for a reply that could never come.
  - **Debugging-seat attempts were marked "edited tests"** because the harness's own setup (putting the failing tests in place) showed up in the agent's diff. Fixed by committing the setup as a baseline in the throwaway worktree.
- One check was wrong, not the runner: it looked for `test_mul` in the failure output, but the test file fails to import before the fix, so pytest reports the import error instead of test names.

### Step 4: a trap in the repo's own .gitignore

- The Python `.gitignore` template ignores every `build/` folder, which would have silently dropped `eval/build/` from git. `git add` reports success and stages nothing.
- Sanctuary's `SanctuaryWorld/README.md` documents the same trap costing them Godot files. Fixed with an explicit re-include, checked with `git check-ignore`.

### Step 5: the result that changed the validation

- A "gold replay" (`eval/tests/gold-replay.mjs`: a fake model writes the commit's real fix through Pi) passed for a Sanctuary task. For LuthiModel's `8867a77e` it broke 3 pass-to-pass tests, though the same fix had passed validation twice.
- Re-running the gold state six times, the outcome alternated: fail, pass, fail, pass, fail, pass. Not random.
- Cause: LuthiModel JIT-compiles its C++ ops (`torch.utils.cpp_extension.load(name="pc_ops_ext")`) into one cache in the home folder, shared by every checkout. Worktrees at different commits loaded each other's builds.
- This also contaminated the validation that was running. Worse than a flaky failure, a spurious failure in the "before" state can make a test look like it went from failing to passing when it didn't.
- Fix: `TORCH_EXTENSIONS_DIR` points at a private cache beside each worktree (not inside it, so it never appears in the agent's diff). Afterwards: six runs, no variation.
- All validation was discarded and re-run from scratch.

### Step 6: instructions

- Written by hand from each commit's message, diff and tests, the way an issue would describe the change.
- They name the interface the hidden tests call: functions, config fields, and substrings the tests assert on. They don't give the implementation.
- This makes the tasks easier than SWE-bench-style issues, deliberately: a small model failing to guess a field name says nothing about whether it can implement.

### Step 7: how many tasks the history holds

Brian asked why a few hundred commits per repo gave so few candidates. Counted:

| | LuthiModel | Sanctuary |
|---|---|---|
| Commits, no merges | 433 | 528 |
| Change source code | 161 | 116 |
| ...and their tests | 81 | 96 |
| Touch a protected file | -2 | -8 |
| Over the size limit | -35 | -55 |
| Candidates | 44 | 33 |

- Most commits change docs, research logs, experiment configs or results. Those are real work, but nothing tests them.
- The size limit, not quality, cut 90 commits. Those became the **large tier** (up to 600 lines in 8 files), scored separately (`docs/decisions.md`).
- About 100 commits changed source without tests. Making tasks of them would mean writing the check myself, so the test would be my reading of the change rather than the repo's. Not done.

### Step 8: renames broke two candidates

- `git log --numstat` writes a moved file as `{old => new}/file`, which isn't a path.
  - Validation silently skipped those files, so `sanctuary-ed01b3e8` (a 4-line change plus three moves) validated while ignoring the moves.
  - `sanctuary-3bcbed07` was rejected as "no tests ran".
- Fixed with `--no-renames`. Counted honestly, `ed01b3e8` exceeds the size limit and was dropped. `3bcbed07` was re-validated.

### Step 9: an instruction for every task

- Every standard task now has an instruction, so the implementation seat uses all of them instead of 23.
- For bug fixes, the instruction describes the symptom, the way an issue would. For features, it gives the interface and behavior the hidden tests check.
- Some instructions are close to specs (exact thresholds, formulas) because the tests pin exact values. Those tasks measure careful implementation more than design.
- **Collection errors make many tests fail-to-pass.** When a new test file fails to import on the parent commit, pytest collects nothing, so every test in the task's files is "failing before". On those tasks pass-to-pass is empty, but breaking an existing test still fails the check, because fail-to-pass then includes it.

### Step 10: what might differ on Windows

- Validation ran on Linux, so a few tasks may not resolve on Windows even with the real fix:
  - Tests that skip there (symlinks, `/proc`) count as not passed.
  - LuthiModel's C++ parity tests skip without a compiler.
- The gold replay of every task on Brian's PC is the check. A task whose real fix doesn't resolve there is left out of runs on that machine.

## Conclusion

The eval exists and its parts are tested:
- the runner end to end with a scripted model (18 checks)
- gold replays of real tasks through Pi and the guard
- validation with isolated build caches

The final task count and the gold-replay results are in `eval/build/validation.md`.

**Open:**
- Nothing has run on Windows yet.
- Whether the full task set resolves on Windows (Step 10).
- Whether instructions written by Claude bias the eval toward Claude's way of describing work is untested. A cross-check would be a handful of tasks with instructions written by Brian or another model family.
- The torch/torchaudio mismatch in LuthiModel's lockfile.

## Artifacts

- `eval/lib.mjs`, `eval/run.mjs`, `eval/setup.mjs`
- `eval/build/mine.mjs`, `eval/build/validate.mjs`
- `eval/tests/fake-model.mjs`, `eval/tests/runner.e2e.mjs`, `eval/tests/gold-replay.mjs`
- `eval/tasks/` (task specs)
