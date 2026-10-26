# Eval

Measures how well the local agent does real work in LuthiModel and Sanctuary, so each harness change, setting or model swap can be judged by results instead of guesses.

## How a task works

Each task is a real past commit that changed some code together with the tests that check it.

1. A throwaway git worktree is made at the commit's parent, so the code is as it was before the change.
2. The agent gets a plain-language description of the change (implementation seat), or only the failing test output (debugging seat). It doesn't see the commit's tests.
3. Pi runs unattended with only the named LuthiCode extensions loaded (always including the `protect-paths` guard), and is stopped at the time limit.
4. The commit's test files are put in place, overwriting any edits the agent made to them, and run.
5. The attempt is **resolved** if every `fail_to_pass` test now passes and no `pass_to_pass` test broke.

Task files are in `tasks/<repo>/<id>.json`. Every task was validated before it was added: its tests fail on the parent commit and pass, twice, with the real change. A task's check that passes before the agent starts would measure nothing.

**Tiers.** Standard tasks fit each repo's size limit (LuthiModel: 150 changed source lines in 3 files; Sanctuary: 300 in 4). Large tasks (`"tier": "large"`) go up to 600 lines in 8 files. The two tiers are run and reported separately, so the large tier never drags down the standard number. See `docs/decisions.md`.

## Setup (once, on Brian's PC)

1. Copy `config.example.json` to `config.local.json` and set `work` to a folder with ~30 GB free. The eval keeps its own clones of both repos, their test environments, and its scratch space there. Don't use `E:\runs` or the experiment archive; the guard protects those.
2. `node eval/setup.mjs`. This clones both repos, builds a CPU-only test environment for each from its `uv.lock`, and runs one quick test in each. The environments are several GB each, so the first run takes a while.
3. `node eval/tests/gold-replay.mjs`. A scripted model writes the real fix for one task per repo through Pi and the guard, and each must come out resolved. This checks the whole pipeline without the model or GPU.
4. **Before the first baseline, replay every task:** `node eval/tests/gold-replay.mjs luthimodel- sanctuary-` (one to two hours on CPU).
   - The tasks were validated on Linux, and a few may behave differently on Windows:
     - Tests that skip there, such as symlink tests or paths that need `/proc`, count as not passed.
     - LuthiModel's C++ ops need a compiler. Without one, the C++ parity tests skip.
   - A task whose real fix doesn't resolve on your machine can never be resolved by the agent either. List those failures and leave them out of runs on that machine; don't change the tasks.

The model server must be running (`server\start-qwen-server.bat`) for real runs.

## Running

```bat
node eval\run.mjs --label baseline
```

| Option | Default | |
|---|---|---|
| `--label` | (required) | Name for this run |
| `--repeat` | 3 | Attempts per task |
| `--seat` | implementation | Or `debugging` |
| `--tier` | standard | Or `large` (bigger tasks, scored separately) |
| `--repo`, `--only` | all | Narrow the task set |
| `--model`, `--provider`, `--thinking` | qwen3.6-35b-a3b, llama-cpp, off | What to run |
| `--extension <name>` | | Extra extension from `extensions/`, repeatable |
| `--timeout-min` | 30 (60 for large) | Per attempt |
| `--keep` | | Keep worktrees for inspection |

An interrupted run resumes where it stopped if you re-run the same command.

**Output:**
- A summary in `eval/results/<date>_<label>_<seat>.md` (tracked in git).
- Per attempt, in `<work>/runs/<label>/`: the Pi transcript (`.jsonl`), the agent's diff, the test output when unresolved, and one line in `results.jsonl`.

**Time:** with ~20 seconds of agent thinking per step at local speeds, expect several minutes per attempt, so a full baseline (all tasks x 3) is an overnight job. Start with `--repeat 1 --only <id>` to check one task end to end.

## Comparing runs

Follow the rigor rules in `CLAUDE.md`:
- One change per comparison.
- The same tasks and repeat count.
- Report the spread across repeats.
- Judge an extension on the failure it was meant to fix, not only the overall rate.

## Building tasks (Claude sessions)

- `build/mine.mjs` lists candidate commits: a small source change with test changes, touching no protected files. `--tier large` lists the large tier instead.
- `build/validate.mjs` checks each candidate in a worktree and writes the valid ones to `tasks/`, with no instruction yet.
- Instructions are written by hand from the commit message and diff, as an issue would describe the change. They include the names and signatures the tests call (so a task measures implementation, not name guessing), but not the implementation.
- `build/validation.md` records which candidates were rejected and why.

## Tests

- `tests/runner.e2e.mjs` runs the whole runner against a tiny repo and a scripted fake model. It needs Pi, git and uv, but no model or GPU.
- `tests/gold-replay.mjs [task ...]` replays real tasks' own fixes through the runner. Every task must resolve; one that doesn't means the environment, the guard or the task is wrong, not the model.
- `tests/fake-model.mjs` is the scripted model these tests use. (The guard's end-to-end test in `extensions/tests/` has its own copy, so its review stays independent of eval changes.)
