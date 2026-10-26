# LuthiCode

Local agentic coding setup: Qwen3.6-35B-A3B on llama.cpp (Vulkan, Windows), driven by the Pi harness, plus Pi extensions written here.

## Layout
- `server/` - llama-server launcher
- `pi/` - Pi config and installer
- `extensions/` - Pi extensions, one TypeScript file each
- `eval/` - task set, runner, results
- `docs/decisions.md` - read before changing server flags or tool behavior

## Rules
- Prompt-cache safety: never change the system prompt or tool list mid-session. Tools loaded on demand arrive as tool results.
- The context window is set in two places: `CTX` in `server/start-qwen-server.bat` and `contextWindow` in `pi/models.json`. Change both together.
- `.bat` files must stay CRLF (enforced by `.gitattributes`).
- Keep tool descriptions short. Every token in them is paid on every turn.
- Judge changes against `eval/`; record results in `eval/results/`.
- Record any decision that changes behavior in `docs/decisions.md`.
- Commit messages: plain language, what changed and why.
