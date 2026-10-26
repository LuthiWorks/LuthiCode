# Decisions

Newest at the bottom. Benchmark scores are vendor-reported unless noted.

## 2026-10-26 - Model: Qwen3.6-35B-A3B at UD-Q4_K_M

Hardware limit: 16 GB VRAM (RX 7800 XT), 32 GB DDR4-3000.

- **Rejected: Qwen3.6-27B dense** (77.2% SWE-bench Verified). Q4 weights are about 15.5 GB, so holding useful context needs a 24 GB card. Q3 fits, but users report it's noticeably worse for coding. Offloading dense layers to DDR4 is slow.
- **Chosen: Qwen3.6-35B-A3B** (73.4% SWE-bench Verified). Only 3B parameters are active per token, so expert weights can live in system RAM with little penalty. One user reported 33 tokens/s on the same GPU with 32 GB DDR5. DDR4-3000 has about 60% of that bandwidth, so expect about 20-25 tokens/s (estimate, unmeasured).
- **Revisit when Qwen 4 ships.** Alibaba announced a 27B open-weights model with no specs yet. If it's dense, it hits the same 16 GB wall.

## 2026-10-26 - Harness: Pi, extended rather than built from scratch

- Pi's core is four tools (read, write, edit, bash) and a system prompt under 1,000 tokens. Everything else is TypeScript extensions.
- Pi already provides optional grep, find and ls tools (enabled in `pi/settings.json`) and loads `AGENTS.md` automatically. That covers glob, list_dir, grep and the project file from the original spec.
- **Rejected: OpenCode.** It ships more built in, but its heavier default context works against a small model.
- On Windows, Pi's bash tool uses Git Bash. That suits Qwen, which writes Unix-style commands.

## 2026-10-26 - Prompt-cache discipline

With experts on the CPU, processing the prompt is the bottleneck, so a broken cache prefix means reprocessing the whole context every turn.

- Qwen's chat template renders tool schemas into the system prompt. **Never change the tool list mid-session.** `load_tools` must return schemas as a tool result.
- `preserve_thinking: true` is set on the server **even with thinking off**. One measurement showed cross-turn cache reuse at 0% without it and about 86% with it.
- `--no-mmproj` (no vision). With vision loaded, llama-server disables cache reuse.

## 2026-10-26 - Thinking off by default

- Speed: at about 20-25 tokens/s, reasoning tokens are expensive per turn.
- Known Pi + Qwen3.6 failure mode with thinking on: after 2-3 turns, tool calls arrive with empty arguments (Pi issue #3325). The server-side `preserve_thinking` default should prevent it, if llama.cpp merges per-request template settings with server defaults rather than replacing them. Unverified.
- `pi/models.json` defines a second model ID, `qwen3.6-35b-a3b-think`, that turns thinking on, so the eval can compare the two. In single-model mode llama-server ignores the model name, so both IDs use the same weights.

## 2026-10-26 - Sampling: presence_penalty 0

- This departs from Qwen's non-thinking preset (1.5). Qwen's own precise-coding preset uses 0, and penalizing repeated tokens works against code, which reuses identifiers constantly. The eval should confirm it.

## 2026-10-26 - Launcher is a .bat, not PowerShell

- Windows PowerShell 5.1 strips quotes from JSON passed to native programs, which would silently break `--chat-template-kwargs`. cmd passes the argument through intact.

## Sources

- Qwen3.6 27B vs 35B-A3B fit and speed: https://insiderllm.com/guides/qwen-3-6-local-ai-guide/
- 27B needs 24 GB at Q4: https://gpuprix.com/brazil/best-gpu-for-local-llm/qwen3.6-27b
- 27B Q3 coding quality reports: https://reddit.sentinel-team.org/posts/1sxomh1/snapshots/2026-05-02T03%3A06%3A21.60641Z
- 35B-A3B on RX 7800 XT: https://reddit.sentinel-team.org/posts/1w55db1/snapshots/2026-09-04T21%3A20%3A12.3645Z
- Qwen 4 status: https://www.yottalabs.ai/post/qwen-4-release-date-what-is-known-how-to-prepare-2026
- Pi overview: https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/
- Pi on Windows: https://pi.dev/docs/latest/windows
- Pi built-in tools and AGENTS.md: https://www.hascode.com/getting-started-with-pi-an-extensible-ai-agent-harness/
- preserve_thinking cache measurement: https://huggingface.co/plunderstruck/Qwopus3.6-27B-Coder-MTP-ROCmFP4-GGUF
- Vision disables cache reuse: https://huggingface.co/plunderstruck/Qwen3.6-27B-OBLITERATED-MTP-ROCmFP4-GGUF
- Empty tool arguments issue: https://github.com/earendil-works/pi/issues/3325
- Qwen sampling presets: https://unsloth.ai/docs/models/qwen3.6
