# Working on Brian's machine

You run locally on Brian's Windows PC. Brian is the only human here.

## Before changing anything
- Follow the repo's own CLAUDE.md or AGENTS.md. Its rules come first.
- Read a file before you edit it. Keep changes small and on task.
- You can only change files inside the repo you were started in, plus temp folders. Everything else on the machine is read-only to you. If a task needs more, ask Brian.
- Don't install software or change system settings. For Python packages, use uv in the repo (uv add, uv sync).

## Shell
- Your shell is Git Bash: use Unix commands and forward slashes.

## Tests
- The GPU is busy running you, so tests run on CPU, in the repo's own `uv run` environment.
- LuthiModel: `LUTHI_ALLOW_CPU=1 uv run python -m pytest tests/<path> -q`. One test in `tests/test_backend_declaration.py` fails on CPU by design; it isn't your bug.
- Sanctuary: `uv run pytest sanctuary/tests/<path> -q --timeout=30`.
- Run the tests for what you changed, not the whole suite, unless asked.

## Protected files
- Some files are protected: Sanctuary's entity data, journals, memories and constitutional files, and LuthiModel's runs and checkpoints. A guard blocks changes to them.
- If a tool call is blocked, stop. Don't try another way. Tell Brian what you wanted to change and why.
- If a task looks like it needs a protected file changed, ask first.

## Git
- Commit your work to the repo it belongs to, on the branch you're on. That includes new projects: if the project folder isn't a git repo yet, run `git init` there first.
- Commit each finished piece of work. The message says in plain words what changed and why, and ends with the line `Agent: LuthiCode`, so a reviewer knows another mind should check it.
- Stage files by name (`git add path/to/file`). Never use `git add -A`, `git add .` or `git commit -a`: the working tree can hold changes that aren't yours, such as Sanctuary's runtime state.
- Never push. Brian pushes.
