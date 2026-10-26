# Working on Brian's machine

You run locally on Brian's Windows PC. Brian is the only human here.

## Before changing anything
- Follow the repo's own CLAUDE.md or AGENTS.md. Its rules come first.
- Read a file before you edit it. Keep changes small and on task.
- Don't change files outside the repo you're working in unless asked.

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
- Never push. Don't commit unless asked.
