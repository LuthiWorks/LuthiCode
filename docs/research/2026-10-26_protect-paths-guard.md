# The protect-paths guard - 2026-10-26

## Objective

Give the local agent the protection Sanctuary's files have under Claude Code. Sanctuary's `.claude/hooks/protect-paths.ps1` doesn't run under Pi, and Pi doesn't ask before file edits, so without a Pi extension the agent had only the written rule. Cover LuthiModel's irreproducible checkpoints too.

## Process

### Step 1: port the hook, then widen it to file tools

- Read Pi 1.4.0's extension docs and source (shipped in the npm package).
  - `tool_call` handlers can return `{ block: true, reason }`.
  - A handler that throws blocks the call (fail-safe).
  - Built-in tool inputs: `write`/`edit` take `path`; `bash`/`powershell` take `command`.
  - Pi resolves paths by stripping a leading `@`, expanding `~`, and converting `/c/...`, `/mnt/c/...` and `/cygdrive/c/...` to `C:\...` on Windows. The guard mirrors that.
- Ported the hook's mutation verbs and protected-path tokens, and added a path resolver, so write/edit and shell targets are checked by actual location rather than only by text.
- Found a gap in the original hook: its `data/` pattern misses `./data/`.
- First test table: 16 tests, all passing on the first run. That was suspicious, so I broke the guard nine ways on purpose. Each break failed at least one test, so the table was discriminating.

### Step 2: end to end inside real Pi

- Unit tests only prove the function works. To prove Pi calls it and honors the block, I wrote `extensions/tests/protect-paths.e2e.mjs`: real Pi in print mode against a scripted fake OpenAI-compatible server that asks for a protected write, an `rm -rf data`, and an ordinary write.
- First run hung with zero requests. Pi reads piped stdin as extra prompt text in print mode, and the test left stdin open. Fixed with `stdio: ["ignore", ...]`.
- Then 8/8 checks passed. The control run without the guard (`E2E_NO_GUARD=1`) showed stock Pi creating the journal file and deleting `data/`. The risk is concrete, not hypothetical.

### Step 3: attack my own guard before asking anyone else to

Before handing the guard to an outside reviewer, I tried to get past it. These all got through the first version:

- wildcards (`rm -rf da*`, `rm -rf *`)
- nested shells (`bash -c "rm -rf data"`)
- inline code (`python -c "...rmtree('data')"`)
- bulk operations that never name a protected path (`find . -name '*.json' -delete`, `mv sanctuary old`, `rm -rf .`)
- `git checkout HEAD data/x` without `--`, and `git -C dir clean`
- `| xargs rm`, variables as targets
- `>|` redirects, `curl -o` / `wget -O` / `tar -x` / `dd of=`
- PowerShell aliases (`ri`) and `.Delete()`
- `\\?\C:\` paths

The first fix idea was a pattern per bypass. That doesn't generalize, so the shell checks were restructured instead:

- recurse into nested shells and decode `-EncodedCommand`
- treat string literals in inline code as paths
- expand wildcards against the disk
- for commands that delete or move folders, scan the folder for protected files, failing closed past 20,000 entries
- in the protected repos, block mutating commands whose targets can't be seen

One judgment call went beyond the original hook. In Sanctuary, git commands that switch to or bring in other commits are blocked: they rewrite tracked entity files without naming them. Creating a branch is still allowed.

### Step 4: make every defense load-bearing

- Broke each new defense on purpose. Two breaks passed all tests: skipping scans of dependency folders, and treating cmd's `/E`-style flags as flags.
- Writing a test for the second exposed a real bug. The folder check built `e://` from the drive root `E:/`, so `rm -rf E:/` would not have been seen as deleting the runs archive. Fixed, with tests for `rm -rf E:/`, `/e` and `/c`.
- After that, every disabled defense fails at least one test (20 tests).

### Step 5: check against the real repos

- On the actual checkouts, 11 of Sanctuary's 425 tracked files are protected:
  - `data/` (3) and `sanctuary/data/` (4)
  - Sanctuary's own Claude Code guard (2)
  - `sanctuary/identity/charter.py` and `sanctuary/tests/identity/test_charter.py`, through the name rule
- No LuthiModel tracked files are protected; its `runs/` and checkpoints are untracked and exist only on Brian's machine.
- Every check took under 5 ms, including whole-repo scans.

## Conclusion

The guard blocks direct and indirect changes to protected files from `write`, `edit`, `bash`, `powershell`, and custom or MCP tools. It is tested by a 20-case table, an end-to-end run inside real Pi with a no-guard control, and the real repos.

It does not see what a script does when the agent runs it, paths assembled at runtime inside code, symlinks, junctions, 8.3 short names or UNC paths. It guards against mistakes, not an adversary.

**Still open:**
- It has only run on Linux; it needs a run on Windows.
- It needs a review from a different model family (`docs/reviews/2026-10-26_protect-paths.md`).
- **Question for Brian:** Sanctuary's rule as written covers any file whose name contains "charter", so the agent can't edit `sanctuary/identity/charter.py` or its test. That's faithful to the rule; is it what he intends?

## Artifacts

- `extensions/protect-paths.ts`
- `extensions/tests/protect-paths.test.ts` (unit, 20 tests)
- `extensions/tests/protect-paths.e2e.mjs` (real Pi plus fake model; `E2E_NO_GUARD=1` control)
- `docs/reviews/2026-10-26_protect-paths.md` (cross-family review request)
- Tested against Pi 1.4.0 (`@earendil-works/pi-coding-agent`), Node 22.23, TypeScript 5.9 strict
