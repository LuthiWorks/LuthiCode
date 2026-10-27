# LuthiCode

Local agentic coding setup: Qwen3.6-35B-A3B on llama.cpp, driven by the Pi harness, plus Pi extensions written here. It runs on Windows, Linux and macOS; the reference machine is Windows with an AMD GPU (Vulkan).

## Layout
- `server/` - llama-server launcher and its settings (`server.json`)
- `pi/` - Pi config and installer
- `extensions/` - Pi extensions, one TypeScript file each
- `eval/` - task set, runner, results
- `docs/plan.md` - what gets built, in what order
- `docs/decisions.md` - read before changing server flags or tool behavior

## Rules
- Prompt-cache safety: never change the system prompt or tool list mid-session. Tools loaded on demand arrive as tool results.
- The context window is set in one place, `ctx` in `server/server.json`. The installer (`pi/install.mjs`) copies it into Pi's models.json; re-run it after a change.
- Harness scripts are Node, so they run on every OS. `.bat` and `.sh` files are one-line wrappers.
- `.bat` files must stay CRLF (enforced by `.gitattributes`).
- Keep tool descriptions short. Every token in them is paid on every turn.
- Never weaken or bypass the `protect-paths` extension, even to make a task pass.
- Extension tests must run without the model server, and pass on Windows, Linux and macOS (CI runs them on all three).
- Judge changes against `eval/`; record results in `eval/results/`.
- Record any decision that changes behavior in `docs/decisions.md`.
- Commit messages: plain language, what changed and why.
