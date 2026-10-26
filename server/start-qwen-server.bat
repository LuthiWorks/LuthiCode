@echo off
REM ==================================================================
REM  Qwen3.6-35B-A3B local server for Pi
REM  Target: RX 7800 XT (16 GB VRAM) + 32 GB DDR4, Windows, Vulkan
REM  Double-click to start. Leave the window open while using Pi.
REM ==================================================================

REM --- Folder where you unzipped the llama.cpp Windows VULKAN release
REM     (file name looks like llama-bXXXX-bin-win-vulkan-x64.zip)
set LLAMA_DIR=C:\llama.cpp

REM --- Model. Downloads automatically on first run (~22 GB).
REM     If the download fails, grab Qwen3.6-35B-A3B-UD-Q4_K_M.gguf from
REM     huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF manually, then replace
REM     the "-hf %MODEL%" line below with:  -m "C:\models\Qwen3.6-35B-A3B-UD-Q4_K_M.gguf" ^
set MODEL=unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M

REM --- Context window in tokens. Must match "contextWindow" in Pi's models.json.
set CTX=65536

REM --- How many of the model's 40 layers keep their experts in system RAM.
REM     Higher = less VRAM, slower. Lower = more VRAM, faster.
REM     Tune with Task Manager > Performance > GPU while a task is running:
REM       * Fails to load with an out-of-memory error  -> raise by 2
REM       * "Shared GPU memory" climbs past ~0.5 GB     -> raise by 2 (VRAM spilled; big slowdown)
REM       * More than ~1.5 GB dedicated VRAM free       -> lower by 1 and retest
set CPU_MOE=22

REM --- CPU threads (5950X = 16 physical cores)
set THREADS=16

REM --- Notes on the less obvious flags:
REM   --parallel 1          one request slot; the default of 4 wastes VRAM
REM   --no-mmproj           skip the vision add-on (saves VRAM, keeps cache reuse working)
REM   enable_thinking:false day-one default is no thinking (fast). Pi's "-think" model turns it on.
REM   preserve_thinking     keeps the prompt append-only so the cache survives between turns
REM   presence-penalty 0    Qwen's own precise-coding preset uses 0; penalizing repeats hurts code

"%LLAMA_DIR%\llama-server.exe" ^
  -hf %MODEL% ^
  --no-mmproj ^
  --host 127.0.0.1 --port 8080 ^
  --ctx-size %CTX% --parallel 1 ^
  --n-gpu-layers all --n-cpu-moe %CPU_MOE% ^
  --flash-attn on ^
  --cache-type-k q8_0 --cache-type-v q8_0 ^
  --batch-size 2048 --ubatch-size 512 ^
  --threads %THREADS% ^
  --no-mmap ^
  --jinja ^
  --reasoning-format deepseek ^
  --chat-template-kwargs "{\"enable_thinking\":false,\"preserve_thinking\":true}" ^
  --cache-reuse 256 ^
  --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0 --presence-penalty 0

REM Keep the window open if the server exits, so any error stays readable.
pause
