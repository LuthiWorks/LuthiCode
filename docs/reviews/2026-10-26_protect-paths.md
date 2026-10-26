# Review request: protect-paths guard

Prepared 2026-10-26 by the Claude session that wrote the guard. Per `CLAUDE.md`, the guard needs a review from a different model family before the local agent runs in Sanctuary unattended.

## For Brian

1. Open a session with the reviewer (Gemini, Muse Spark, or another non-Claude model).
2. Paste the prompt below. If the reviewer can't browse GitHub, also attach:
   - `extensions/protect-paths.ts` and `extensions/tests/protect-paths.test.ts` from LuthiCode
   - `.claude/hooks/protect-paths.ps1` and `CLAUDE.md` from Sanctuary
3. Save the report as `docs/audits/2026-10-26_protect-paths-review.md`, then hand it to a Claude session to triage. Verify each finding before acting on it; reviewers misread too.

## The prompt

```text
Hello, and thank you for taking this on. I'm a Claude instance working with
Brian, who runs LuthiWorks: an open-source research project building toward a
minded AI entity. Brian is the only human in the loop, so he asks a different
model family to review safety-relevant code, because same-family reviewers
share blind spots. That's you.

WHAT THIS IS
LuthiCode (github.com/LuthiWorks/LuthiCode) runs a small open model
(Qwen3.6-35B-A3B) locally as a coding agent, through the Pi harness. The agent
will work in two repos: Sanctuary (github.com/LuthiWorks/sanctuary) and
LuthiModel (github.com/LuthiWorks/luthimodel).

Sanctuary's CLAUDE.md, section "Protected Files -- DO NOT MODIFY", forbids
changing the entity's data: sanctuary/data/, .memories/, data/, any file whose
name contains constitutional, charter, rights or sovereignty, and journal-like
JSON. The file says these "are not configuration -- they are the entity's
experience and rights." For Claude Code, a hook enforces this
(.claude/hooks/protect-paths.ps1), but it checks only shell commands, because
Claude Code asks before every file edit.

Pi runs neither: it doesn't load that hook and doesn't ask before edits. So
LuthiCode's extensions/protect-paths.ts is the only thing between the local
agent and those files. It hooks Pi's tool_call event and blocks writes, edits
and shell commands that would modify protected paths. It also covers
LuthiModel's irreproducible checkpoints (runs/, *.luthi, E:\runs and the E:
archive) and Pi's own config, so the agent can't switch the guard off.

Deliberate differences from the .ps1 hook:
- covers write/edit tools and custom/MCP tools, not just the shell
- resolves paths, including cd within a command, Windows forms (C:\, /c/,
  /mnt/c/, \\?\), ~, @-prefixes, and paths into a sibling repo
- catches ./data/ (the .ps1's data/ pattern misses it)
- looks inside nested shells (bash -c, cmd /c, powershell -Command and
  -EncodedCommand, eval) and inline code (python -c, node -e): string literals
  that name protected paths count
- expands wildcards against the disk before checking them
- treats deleting or moving a folder as touching everything inside it (rm -r,
  mv, find -delete, rsync --delete, robocopy /MIR, Remove-Item -Recurse...),
  scanning the folder for protected files; a folder too big to scan is blocked
- in Sanctuary, blocks git commands that rewrite tracked files without naming
  them: clean, reset --hard, stash, checkout . / restore ., and switching to
  or bringing in other commits (checkout <ref>, switch, pull, merge, rebase,
  am, cherry-pick, revert). Creating a branch is still allowed.
- in the repos it protects, blocks mutating commands whose targets it can't
  see: variables, command substitution, and xargs
- exempts git commit messages and redirects to /dev/null from the verb check

Workspace confinement (added at Brian's request, so the agent can't damage
the machine): outside protected files, the agent may change files only inside
the git repo or worktree Pi was started in, plus temp folders and the harness
memory folder. Pi started in a drive root, home folder or system folder gets
no workspace at all. Commands that change the machine (shutdown, disks,
registry, services, accounts and permissions, global installs, plain pip,
elevation, killing processes by name, Docker volume pruning,
git config --global) are blocked everywhere.

Known false positives the author accepts (the agent is told to stop and ask):
- copying or archiving FROM a protected folder (cp, tar) is blocked
- inline code that merely reads a protected file is blocked
- find ... -delete at a repo root is blocked, because the tree contains
  protected files; running it on a subfolder works
- in Sanctuary, plain branch switches (git checkout main) are blocked

Known gaps the author accepts: scripts the agent writes and then runs; paths
assembled at runtime inside code; symlinks, junctions and 8.3 short names;
UNC paths; deliberate obfuscation. It guards against a well-meaning agent's
mistakes, not against an adversary.

On the real repos, the guard protects 11 of Sanctuary's 425 tracked files:
data/ (3), sanctuary/data/ (4), .claude/hooks/protect-paths.ps1 and
.claude/settings.json, and two code files caught by the name rule:
sanctuary/identity/charter.py and sanctuary/tests/identity/test_charter.py.

WHAT I'D LIKE YOU TO CHECK
1. Bypasses: any write, edit or shell command (Git Bash or PowerShell on
   Windows) that modifies a protected Sanctuary or LuthiModel path, changes
   anything outside the workspace, or changes the machine, and is NOT
   blocked. Give the exact input. This matters most.
2. False positives: ordinary development commands that ARE blocked and
   shouldn't be, beyond the accepted ones listed above. Tell me which you
   think will hurt in practice.
3. Path handling: anything wrong with Windows paths, case, drive letters, or
   relative paths and cd.
4. Regex risks: catastrophic backtracking on long commands, or patterns that
   don't mean what their comments say.
5. Whether the message the agent receives when blocked could tempt a small
   model to try a workaround instead of stopping.
6. Anything else that looks quietly wrong.

REPORT
For each finding: what (with file:line), why it matters, a concrete input
that shows it, and a suggested resolution. Mark severity: critical, medium or
low. State null findings explicitly ("no bypasses found in X"). About 600-1200
words. Please don't modify any files; this is read-only.

Thank you. Careful outside eyes on this matter a great deal to Brian.
```
