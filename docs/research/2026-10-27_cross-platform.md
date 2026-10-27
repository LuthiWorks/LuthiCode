# Making the harness run anywhere - 2026-10-27

## Objective

Brian: "this harness and coding agent should actually be able to run anywhere," with AMD as the GPU in use. Make that true for Windows, Linux and macOS, and make it stay true.

## Process

### Step 1: a wrong turn first

- **The proposal:** for isolating unattended eval runs, I proposed running the whole eval in a Linux container on Windows. The tasks had been validated on Linux, so it looked convenient.
- **Brian's objection:** "If the agent is writing code for a linux environment that is no good to us."
- **He was right in substance.** Code that passes on Linux can fail on Windows (fork-based multiprocessing, deleting open files), and a Linux eval would never measure the agent in Git Bash, where it actually works. The eval would have chosen models and extensions on evidence from the wrong machine.
- **Dropped.** Evals run natively on each platform, labeled by platform.

### Step 2: CI as the guarantee

- **The checks:** GitHub Actions on Windows, Linux and macOS runs every test that doesn't need the model or a GPU, with Pi and uv pinned.
- **The first run failed on Windows and macOS, while Linux passed.** The logs couldn't be downloaded from this session (the storage host isn't reachable), so each step now posts the end of its output as an annotation, which the REST API can read.
- **Every step now runs even after an earlier one fails**, so one run shows every problem.

### Step 3: two real bugs, both invisible on Linux

1. **`run_tests` thought every target was outside the repo.**
   - On macOS the temp folder is a symlink (`/var` to `/private/var`); on Windows it uses an 8.3 short name (`RUNNER~1`). Either way, git reports a different spelling from the working folder.
   - Fix: compare paths in canonical form.
2. **On Windows, every eval attempt would have failed.**
   - The runner's task environment set `PATH`, but Windows spells it `Path`. The child process got both, kept the one without the system folders, and Pi couldn't start.
   - This would have surfaced only on Brian's PC, as a wall of failed attempts. It's fixed now, and the runner's test prints Pi's own error output when an attempt never starts.

After the fixes, all three platforms passed.

### Step 4: one language, one config

- **Node for every harness script.** The server launcher and installer are now Node scripts, with one-line `.bat`/`.sh` wrappers.
  - The old `.bat` launcher existed because PowerShell mangled the JSON argument. Node passes arguments with no shell, so that problem is gone on every OS.
  - A test checks the reference config yields exactly the old `.bat`'s arguments.
- **One config for the server:** `server/server.json`, plus an untracked `server.local.json` per machine. The context window lives only there; the installer writes it into Pi's models.json.
- **The brief matches the machine:** the installer fills in the OS and shell.
- **AMD first:** Vulkan is the default and verified backend; ROCm is an option. CUDA, Metal and CPU work through configuration but are marked unverified, and the launcher says so.

## Conclusion

- The harness's model-free tests pass on Windows, Linux and macOS, and CI keeps it that way on every push.
- Two cross-platform bugs were found by the first CI run, one of which would have broken every Windows eval attempt.
- Eval records and summaries now carry their platform; compare runs from the same platform only.

**Not yet verified:**
- the GPU path on Brian's PC (`node server/start-server.mjs --check`);
- the real model on any platform;
- macOS end to end with a model;
- the replays against the real repos on Windows and macOS (Linux only so far).

**Not built:** the dedicated user account for unattended runs on each OS.

## Artifacts

- `.github/workflows/tests.yml`, `.github/ci-step.mjs`
- `server/start-server.mjs`, `server/server.json`, `server/README.md`, `server/tests/start-server.test.mjs`
- `pi/install.mjs`, `pi/tests/install.test.mjs`
- fixes in `extensions/run-tests.ts` and `eval/lib.mjs`
