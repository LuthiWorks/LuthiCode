// Start the local model server (llama.cpp's llama-server) for Pi, on any OS.
//
//   node server/start-server.mjs            start it (leave it running while you use Pi)
//   node server/start-server.mjs --dry-run  print the command instead of running it
//   node server/start-server.mjs --check    list the devices this llama.cpp build sees
//   node server/start-server.mjs --verify   check that the running server refuses
//                                           requests without the key and accepts Pi's
//
// Settings: server/server.json (the reference setup: Brian's RX 7800 XT, 16 GB
// VRAM, 32 GB RAM, Vulkan), overridden by server/server.local.json if it
// exists (untracked; use it for another machine) and by LLAMA_DIR. Tuning notes
// are in server/README.md.
//
// The arguments go to llama-server as a list, with no shell in between, so the
// JSON in --chat-template-kwargs needs no quoting on any platform. (That quoting
// is why the old launcher was a .bat file and not PowerShell.)
//
// API key: the server only listens on this machine, but without a key any web
// page open in a local browser could send it requests (llama-server allows every
// origin). So it requires a key, a random one per machine, kept in Pi's agent
// folder (llama-server.key), never in the repo. The launcher passes it as a file,
// so it doesn't show in the process list or in --dry-run; the installer writes the
// same key into Pi's models.json. Whichever runs first creates it.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const BACKENDS = ["vulkan", "rocm", "cuda", "metal", "cpu"];
/** Backends checked on real hardware. The rest are supported by configuration but unverified. */
export const VERIFIED_BACKENDS = ["vulkan"];

/** server.json, with server.local.json's fields on top. */
export function loadServerConfig(dir = here) {
	const base = JSON.parse(readFileSync(join(dir, "server.json"), "utf-8"));
	const localPath = join(dir, "server.local.json");
	const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
	const cfg = { ...base, ...local, sampling: { ...base.sampling, ...(local.sampling ?? {}) } };
	if (!BACKENDS.includes(cfg.backend)) throw new Error(`server config: backend must be one of ${BACKENDS.join(", ")} (got ${cfg.backend})`);
	for (const k of ["ctx", "cpu_moe", "port"]) if (!Number.isInteger(cfg[k]) || cfg[k] < 0) throw new Error(`server config: ${k} must be a whole number (got ${cfg[k]})`);
	return cfg;
}

/** Pi's agent folder: PI_CODING_AGENT_DIR, or ~/.pi/agent. */
export function piAgentDir(env = process.env, home = homedir()) {
	return env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
}

/** Where this machine's server key lives. */
export function apiKeyPath(agentDir = piAgentDir()) {
	return join(agentDir, "llama-server.key");
}

/** This machine's server key, created on first use (64 hex characters, readable only by this user on Linux and macOS). */
export function ensureApiKey(path = apiKeyPath()) {
	if (existsSync(path)) {
		const key = readFileSync(path, "utf-8").split(/\r?\n/)[0].trim();
		if (key) return key;
	}
	mkdirSync(dirname(path), { recursive: true });
	const key = randomBytes(32).toString("hex");
	writeFileSync(path, key + "\n", { mode: 0o600 });
	return key;
}

/** The key Pi will send, from its installed models.json, or null if it can't be read. */
export function piKey(agentDir = piAgentDir()) {
	try {
		const models = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf-8"));
		return models.providers?.["llama-cpp"]?.apiKey ?? null;
	} catch {
		return null;
	}
}

/** Where to look for llama.cpp when nothing says otherwise. */
export function defaultLlamaDir(platform = process.platform, home = homedir()) {
	return platform === "win32" ? "C:\\llama.cpp" : join(home, "llama.cpp");
}

/** The llama-server program: config llama_dir, then LLAMA_DIR, then PATH, then the platform default folder. */
export function findServer(cfg, { platform = process.platform, env = process.env, exists = existsSync, which = whichOnPath } = {}) {
	const exe = platform === "win32" ? "llama-server.exe" : "llama-server";
	const dirs = [cfg.llama_dir, env.LLAMA_DIR].filter(Boolean);
	for (const d of dirs) {
		for (const p of [join(d, exe), join(d, "bin", exe), join(d, "build", "bin", exe)]) if (exists(p)) return p;
	}
	const onPath = which(exe);
	if (onPath) return onPath;
	const fallback = defaultLlamaDir(platform);
	for (const p of [join(fallback, exe), join(fallback, "bin", exe), join(fallback, "build", "bin", exe)]) if (exists(p)) return p;
	return null;
}

function whichOnPath(exe) {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [exe], { encoding: "utf-8" });
	return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
}

/** Physical-ish core count: half the logical CPUs (SMT), at least 1. */
export function autoThreads() {
	return Math.max(1, Math.floor(cpus().length / 2));
}

/** llama-server's arguments for a config. With keyFile, requests must carry that file's key. */
export function buildArgs(cfg, { keyFile } = {}) {
	const s = cfg.sampling;
	const threads = cfg.threads === "auto" ? autoThreads() : cfg.threads;
	return [
		...(cfg.model_file ? ["-m", cfg.model_file] : ["-hf", cfg.model]),
		// Skip the vision add-on: saves VRAM and keeps cache reuse working.
		"--no-mmproj",
		"--host", cfg.host, "--port", String(cfg.port),
		// One request slot; the default of 4 wastes VRAM.
		"--ctx-size", String(cfg.ctx), "--parallel", "1",
		// Experts of the first cpu_moe layers stay in system RAM (see server/README.md).
		"--n-gpu-layers", "all", "--n-cpu-moe", String(cfg.cpu_moe),
		"--flash-attn", "on",
		"--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
		"--batch-size", "2048", "--ubatch-size", "512",
		"--threads", String(threads),
		// Load the weights into RAM, no memory-mapping. Older builds spelled this --no-mmap.
		"--load-mode", "none",
		"--jinja",
		"--reasoning-format", "deepseek",
		// No thinking by default (Pi's "-think" model turns it on); preserve_thinking keeps
		// the prompt append-only so the cache survives between turns.
		"--chat-template-kwargs", JSON.stringify({ enable_thinking: false, preserve_thinking: true }),
		"--cache-reuse", "256",
		// Qwen's precise-coding preset; penalizing repeats hurts code.
		"--temp", String(s.temp), "--top-p", String(s.top_p), "--top-k", String(s.top_k), "--min-p", String(s.min_p), "--presence-penalty", String(s.presence_penalty),
		...(keyFile ? ["--api-key-file", keyFile] : []),
		...(cfg.extra_args ?? []),
	];
}

/** Ask the running server for its model list without the key, then with it. */
export async function verifyKey(cfg, key) {
	const host = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host;
	const url = `http://${host}:${cfg.port}/v1/models`;
	const status = async (headers) => {
		try {
			return (await fetch(url, { headers, signal: AbortSignal.timeout(5000) })).status;
		} catch {
			return null;
		}
	};
	return { url, without: await status({}), with: await status({ Authorization: `Bearer ${key}` }) };
}

const RELEASE_HINT = {
	vulkan: "the llama.cpp release built for Vulkan (Windows: llama-bXXXX-bin-win-vulkan-x64.zip)",
	rocm: "a llama.cpp build for ROCm/HIP (AMD)",
	cuda: "the llama.cpp release built for CUDA (NVIDIA)",
	metal: "the llama.cpp release for macOS (Metal)",
	cpu: "the llama.cpp CPU release",
};

async function main() {
	const argv = process.argv.slice(2);
	const cfg = loadServerConfig();
	const server = findServer(cfg);
	const keyFile = apiKeyPath();
	const args = buildArgs(cfg, { keyFile });
	if (argv.includes("--dry-run")) {
		// Prints the key file's path, never the key, and creates nothing.
		console.log([server ?? "llama-server", ...args].map((a) => (/[\s"{]/.test(a) ? JSON.stringify(a) : a)).join(" "));
		return;
	}
	const key = ensureApiKey(keyFile);
	if (argv.includes("--verify")) {
		const r = await verifyKey(cfg, key);
		if (r.without === null) {
			console.error(`No server answering at ${r.url}. Start it first.`);
			process.exitCode = 1;
		} else if (r.without === 503) {
			// llama-server answers 503 to everything but /health until the model is loaded.
			console.error(`The server at ${r.url} is still loading the model. Try again once its log says it's listening.`);
			process.exitCode = 1;
		} else if (r.without === 401 && r.with === 200) {
			console.log(`OK: the server refuses requests without the key (401) and accepts the key (200).`);
		} else {
			console.error(`Not protected as expected: without the key ${r.without}, with it ${r.with} (want 401 and 200). Restart the server with this launcher.`);
			process.exitCode = 1;
		}
		if (piKey() !== key) console.error(`Pi's models.json has a different key. Run the installer again (pi\\install-config.bat or pi/install.sh).`);
		return;
	}
	if (!server) {
		console.error(`Can't find llama-server. Download ${RELEASE_HINT[cfg.backend]}, unzip it to ${defaultLlamaDir()} (or anywhere, and set "llama_dir" in server/server.local.json or the LLAMA_DIR environment variable).`);
		process.exitCode = 1;
		return;
	}
	if (!VERIFIED_BACKENDS.includes(cfg.backend)) console.error(`Note: the ${cfg.backend} backend is supported by configuration but hasn't been verified on real hardware yet.`);
	if (argv.includes("--check")) {
		const r = spawnSync(server, ["--list-devices"], { stdio: "inherit" });
		process.exitCode = r.status ?? 1;
		return;
	}
	if (piKey() !== key) console.error(`Note: Pi's models.json doesn't have this server's key yet, so Pi's requests will be refused. Run the installer again (pi\\install-config.bat or pi/install.sh).\n`);
	console.error(`Starting ${server}\nModel ${cfg.model_file ?? cfg.model}, context ${cfg.ctx}, ${cfg.backend}. Requests need the key in ${keyFile}. Leave this running while you use Pi.\n`);
	const child = spawn(server, args, { stdio: "inherit" });
	const stop = () => child.kill();
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	child.on("close", (code) => {
		process.exitCode = code ?? 1;
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((e) => {
		console.error(String(e.message ?? e));
		process.exitCode = 1;
	});
}
