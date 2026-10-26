# LuthiCode

Agentic coding harness developed by LuthiWorks: **Qwen3.6-35B-A3B** served by **llama.cpp** (Vulkan, Windows), driven by the **Pi** coding harness, plus Pi extensions built here.

Target machine: RX 7800 XT (16 GB), 32 GB DDR4, Ryzen 9 5950X, Windows.

## Layout

| Path | What it is |
|---|---|
| `server/start-qwen-server.bat` | Starts the model server. Tuning notes are in the file's comments. |
| `pi/models.json`, `pi/settings.json` | Pi config: points Pi at the local server. |
| `pi/install-config.bat` | Copies the Pi config into `%USERPROFILE%\.pi\agent\` (backs up existing files). |
| `docs/plan.md` | What gets built, in what order, and the open questions. |
| `docs/decisions.md` | Why things are set up the way they are. |
| `AGENTS.md` | Short rules for anyone working here, including the local model. |
| `CLAUDE.md` | Fuller guidance for Claude sessions (imports `AGENTS.md`). |
| `extensions/` | Pi extensions, starting with `protect-paths`. Added as they're built. |
| `eval/` | Task set and results used to judge each change. Added in Phase 1. |

## Setup

1. Install **Git for Windows** (Pi's shell tool uses Git Bash).
2. Download the llama.cpp Windows Vulkan release (`llama-bXXXX-bin-win-vulkan-x64.zip`) from github.com/ggml-org/llama.cpp/releases and unzip to `C:\llama.cpp`.
3. Run `server\start-qwen-server.bat`. The first run downloads about 22 GB. It's ready when the log says the server is listening.
4. Install Pi: `powershell -c "irm https://pi.dev/install.ps1 | iex"` (or, with Node 22.19+, `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`).
5. Run `pi\install-config.bat`.
6. Check with `pi --list-models qwen`, then run `pi` in a throwaway repo.
7. Tune `CPU_MOE` in the server script using its comments.

## First-run checks

- **Decode speed:** expect roughly 20-25 tokens/s (an estimate, not yet measured).
- **Cache reuse:** from the second turn on, the server log should show prompt processing only for new tokens, not the whole context. Qwen3.6 is a hybrid model, which can't rewind a partly matching cache. If turns keep reprocessing everything, Pi's docs suggest adding `--ctx-checkpoints 32 --checkpoint-min-step 0` to the server; watch VRAM when you do.
- **Tool arguments:** on the `-think` model, tool calls should still carry arguments after 3+ turns (a known failure mode is empty `{}`).

## Status

- [x] Model chosen, server launcher, Pi config
- [x] Build plan (`docs/plan.md`)
- [ ] Phase 0: `protect-paths` guard, global agent brief
- [ ] Phase 1: first run on the target machine, eval runner, baseline
- [ ] Phase 2: extensions, in eval order
- [ ] Phase 3: model and settings comparisons
