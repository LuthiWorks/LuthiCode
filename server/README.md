# The model server

`start-server.mjs` starts llama.cpp's `llama-server` for Pi. It runs the same way on Windows, Linux and macOS.

| Platform | Start it with |
|---|---|
| Windows | double-click `start-qwen-server.bat` |
| Linux, macOS | `./start-server.sh` |
| Any | `node start-server.mjs` |

- `node start-server.mjs --dry-run` prints the exact command without running it.
- `node start-server.mjs --check` lists the devices your llama.cpp build can see. Use it to confirm the GPU is found.
- `node start-server.mjs --verify`, with the server running, checks that it refuses requests without the key and accepts Pi's.

## The API key

The server listens only on this machine, but llama-server accepts requests from any web page by default, so a page open in a local browser could use it. So it requires a key.
- **One random key per machine**, in Pi's agent folder: `%USERPROFILE%\.pi\agent\llama-server.key` (Linux and macOS: `~/.pi/agent/llama-server.key`, readable only by you; `PI_CODING_AGENT_DIR` moves it). It's never in the repo.
- **Created on first use** by the launcher or the installer, whichever runs first. The installer writes the same key into Pi's `models.json`.
- **The launcher passes it as a file** (`--api-key-file`), so it doesn't appear in the process list or in `--dry-run`.
- **If Pi gets "Invalid API Key"**, re-run the installer (`pi\install-config.bat` or `pi/install.sh`). The launcher warns when Pi's key doesn't match.
- **To change the key**, delete the file, re-run the installer, and restart the server.
- `/health` stays open, as llama-server always leaves it; everything else needs the key, including llama-server's own chat page, which has a field for it in its settings.

## Settings

`server.json` is the reference setup: Brian's RX 7800 XT (16 GB VRAM), 32 GB RAM, Ryzen 9 5950X, Vulkan. For another machine, create `server.local.json` (not tracked) with only the fields you change, for example:

```json
{ "cpu_moe": 30, "threads": "auto", "llama_dir": "/opt/llama.cpp" }
```

| Field | Meaning |
|---|---|
| `backend` | Which llama.cpp build you installed: `vulkan`, `rocm`, `cuda`, `metal` or `cpu`. AMD runs Vulkan (verified) or ROCm. The others are supported by configuration but not yet verified on real hardware. |
| `llama_dir` | Folder holding `llama-server`. If unset, the launcher tries the `LLAMA_DIR` environment variable, then your PATH, then `C:\llama.cpp` (Windows) or `~/llama.cpp`. |
| `model`, `model_file` | A Hugging Face model to download on first run (about 22 GB), or a local `.gguf` file, which takes precedence. |
| `ctx` | Context window in tokens. The installer copies it into Pi's `models.json`, so this is the only place to change it. Re-run the installer after changing it. |
| `cpu_moe` | How many of the model's 40 layers keep their experts in system RAM. Higher means less VRAM but slower. |
| `threads` | CPU threads, or `"auto"` for half the logical CPUs. |
| `host`, `port` | Where the server listens. Keep `127.0.0.1` unless you mean to share it. |
| `sampling` | Qwen's precise-coding preset. `presence_penalty` stays 0: penalizing repeats hurts code. |
| `extra_args` | Any further `llama-server` arguments, as a list. |

## Tuning `cpu_moe` (AMD on Windows)

Watch Task Manager > Performance > GPU while a task is running:
- **Fails to load with an out-of-memory error:** raise it by 2.
- **"Shared GPU memory" climbs past about 0.5 GB:** VRAM spilled, which is a big slowdown. Raise it by 2.
- **More than about 1.5 GB of dedicated VRAM free:** lower it by 1 and retest.

## Less obvious flags (in `start-server.mjs`)

- `--parallel 1`: one request slot. The default of 4 wastes VRAM.
- `--load-mode none`: loads the weights into RAM instead of memory-mapping them. llama.cpp replaced `--no-mmap` with this; build b11936 (2026-10-27, the one checked on Brian's PC) rejects `--no-mmap`. A much older build may not know `--load-mode`; there, swap it back to `--no-mmap` in `start-server.mjs`.
- `--no-mmproj`: skips the vision add-on. It saves VRAM and keeps cache reuse working.
- `enable_thinking: false`: no thinking by default, for speed. Pi's `-think` model turns it on.
- `preserve_thinking: true`: keeps the prompt append-only, so the cache survives between turns.
