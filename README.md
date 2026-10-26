# LuthiCode

Agentic coding harness developed by LuthiWorks: **Qwen3.6-35B-A3B** served by **llama.cpp** (Vulkan, Windows), driven by the **Pi** coding harness, plus Pi extensions built here.

Target machine: RX 7800 XT (16 GB), 32 GB DDR4, Ryzen 9 5950X, Windows.

## Layout

| Path | What it is |
|---|---|
| `server/start-qwen-server.bat` | Starts the model server. Tuning notes are in the file's comments. |
| `pi/models.json`, `pi/settings.json` | Pi config: points Pi at the local server. |
| `pi/AGENTS.global.md` | The brief the local model reads in every repo (installed as `AGENTS.md`). |
| `pi/install-config.bat` | Installs the config, brief and extensions into `%USERPROFILE%\.pi\agent\` (backs up existing files). Re-run after pulling changes. |
| `extensions/protect-paths.ts` | The guard: blocks changes to Sanctuary's and LuthiModel's protected files. |
| `extensions/tests/` | Tests that run without the model server. |
| `docs/plan.md` | What gets built, in what order, and the open questions. |
| `docs/decisions.md` | Why things are set up the way they are. |
| `AGENTS.md` | Short rules for anyone working here, including the local model. |
| `CLAUDE.md` | Fuller guidance for Claude sessions (imports `AGENTS.md`). |
| `eval/` | Tasks from LuthiModel's and Sanctuary's history, the runner that scores the agent on them, and results. See `eval/README.md`. |

## Setup

1. Install **Git for Windows** (Pi's shell tool uses Git Bash).
2. Download the llama.cpp Windows Vulkan release (`llama-bXXXX-bin-win-vulkan-x64.zip`) from github.com/ggml-org/llama.cpp/releases and unzip to `C:\llama.cpp`.
3. Run `server\start-qwen-server.bat`. The first run downloads about 22 GB. It's ready when the log says the server is listening.
4. Install Pi: `powershell -c "irm https://pi.dev/install.ps1 | iex"` (or, with Node 22.19+, `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`).
5. Run `pi\install-config.bat`.
6. Check the guard: `node extensions\tests\protect-paths.e2e.mjs` should end with every check passed (10/10). It runs real Pi against a scripted fake model and needs no GPU. **Don't point the agent at Sanctuary until this passes on your machine.**
7. Check with `pi --list-models qwen`, then run `pi` in a throwaway repo. Start Pi inside the project folder (the agent can only change files in that repo), and never as administrator.
8. Tune `CPU_MOE` in the server script using its comments.

## First-run checks

- **Decode speed:** expect roughly 20-25 tokens/s (an estimate, not yet measured).
- **Cache reuse:** from the second turn on, the server log should show prompt processing only for new tokens, not the whole context. Qwen3.6 is a hybrid model, which can't rewind a partly matching cache. If turns keep reprocessing everything, Pi's docs suggest adding `--ctx-checkpoints 32 --checkpoint-min-step 0` to the server; watch VRAM when you do.
- **Tool arguments:** on the `-think` model, tool calls should still carry arguments after 3+ turns (a known failure mode is empty `{}`).

## Tests

- Unit: `node --test extensions/tests/protect-paths.test.ts` (Node 22.18+).
- To let one session change a second repo too, set `LUTHICODE_WORKSPACES` (`;`-separated folders) before starting Pi.
- End to end: `node extensions/tests/protect-paths.e2e.mjs` (needs Pi; set `PI_BIN` if `pi` isn't on your PATH). `E2E_NO_GUARD=1` runs the same scenario without the guard as a control: the protection checks should then fail.

## Status

- [x] Model chosen, server launcher, Pi config
- [x] Build plan (`docs/plan.md`)
- [x] Phase 0: `protect-paths` guard, global agent brief (built and tested on Linux)
- [ ] Phase 0: guard checked on Windows, cross-family review
- [x] Phase 1: eval runner and task set (`eval/`, built and tested on Linux)
- [ ] Phase 1: first run on the target machine, `eval/setup.mjs`, baseline
- [ ] Phase 2: extensions, in eval order
- [ ] Phase 3: model and settings comparisons
