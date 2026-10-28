// Tests for server/start-server.mjs. No model, no GPU, no llama.cpp needed.
// Run: node --test server/tests/start-server.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { apiKeyPath, buildArgs, defaultLlamaDir, ensureApiKey, findServer, loadServerConfig, piKey, verifyKey } from "../start-server.mjs";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the reference config produces the same arguments the old .bat used", () => {
	// Copied from server/start-qwen-server.bat as of 2026-10-27, with its variables filled in.
	// One change since: --no-mmap became --load-mode none, its replacement in llama.cpp b11936.
	const fromBat = [
		"-hf", "unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M",
		"--no-mmproj",
		"--host", "127.0.0.1", "--port", "8080",
		"--ctx-size", "65536", "--parallel", "1",
		"--n-gpu-layers", "all", "--n-cpu-moe", "22",
		"--flash-attn", "on",
		"--cache-type-k", "q8_0", "--cache-type-v", "q8_0",
		"--batch-size", "2048", "--ubatch-size", "512",
		"--threads", "16",
		"--load-mode", "none",
		"--jinja",
		"--reasoning-format", "deepseek",
		"--chat-template-kwargs", '{"enable_thinking":false,"preserve_thinking":true}',
		"--cache-reuse", "256",
		"--temp", "0.7", "--top-p", "0.8", "--top-k", "20", "--min-p", "0", "--presence-penalty", "0",
	];
	const dir = mkdtempSync(join(tmpdir(), "server-cfg-"));
	try {
		copyFileSync(join(serverDir, "server.json"), join(dir, "server.json"));
		assert.deepEqual(buildArgs(loadServerConfig(dir)), fromBat);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("server.local.json overrides fields, including single sampling values", () => {
	const dir = mkdtempSync(join(tmpdir(), "server-cfg-"));
	try {
		copyFileSync(join(serverDir, "server.json"), join(dir, "server.json"));
		writeFileSync(join(dir, "server.local.json"), JSON.stringify({ cpu_moe: 30, model_file: "/models/q.gguf", sampling: { temp: 0.6 } }));
		const cfg = loadServerConfig(dir);
		const args = buildArgs(cfg);
		assert.deepEqual(args.slice(0, 2), ["-m", "/models/q.gguf"]);
		assert.equal(args[args.indexOf("--n-cpu-moe") + 1], "30");
		assert.equal(args[args.indexOf("--temp") + 1], "0.6");
		assert.equal(args[args.indexOf("--top-k") + 1], "20");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a bad backend or number is refused", () => {
	const dir = mkdtempSync(join(tmpdir(), "server-cfg-"));
	try {
		copyFileSync(join(serverDir, "server.json"), join(dir, "server.json"));
		writeFileSync(join(dir, "server.local.json"), JSON.stringify({ backend: "directml" }));
		assert.throws(() => loadServerConfig(dir), /backend must be one of/);
		writeFileSync(join(dir, "server.local.json"), JSON.stringify({ ctx: "64k" }));
		assert.throws(() => loadServerConfig(dir), /ctx must be a whole number/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("threads: auto picks a positive count", () => {
	const args = buildArgs({ ...loadServerConfig(serverDir), threads: "auto" });
	const n = Number(args[args.indexOf("--threads") + 1]);
	assert.ok(Number.isInteger(n) && n >= 1);
});

test("finding llama-server: config, then LLAMA_DIR, then PATH, then the default folder", () => {
	const cfg = { llama_dir: null };
	const files = new Set([join("/opt/llama", "bin", "llama-server")]);
	const exists = (p) => files.has(p);
	const none = () => null;
	assert.equal(findServer({ llama_dir: "/opt/llama" }, { platform: "linux", env: {}, exists, which: none }), join("/opt/llama", "bin", "llama-server"));
	assert.equal(findServer(cfg, { platform: "linux", env: { LLAMA_DIR: "/opt/llama" }, exists, which: none }), join("/opt/llama", "bin", "llama-server"));
	assert.equal(findServer(cfg, { platform: "linux", env: {}, exists, which: () => "/usr/local/bin/llama-server" }), "/usr/local/bin/llama-server");
	assert.equal(findServer(cfg, { platform: "linux", env: {}, exists: () => false, which: none }), null);
	assert.equal(defaultLlamaDir("win32"), "C:\\llama.cpp");
	assert.equal(defaultLlamaDir("darwin", "/Users/b"), join("/Users/b", "llama.cpp"));
});

test("--dry-run prints the full command on this platform, names the key file, and creates nothing", () => {
	const parent = mkdtempSync(join(tmpdir(), "agent-"));
	const agent = join(parent, "agent");
	const r = spawnSync(process.execPath, [join(serverDir, "start-server.mjs"), "--dry-run"], { encoding: "utf-8", env: { ...process.env, PI_CODING_AGENT_DIR: agent } });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /llama-server/);
	assert.match(r.stdout, /--ctx-size 65536/);
	assert.match(r.stdout, /enable_thinking/);
	assert.ok(r.stdout.includes(`--api-key-file ${apiKeyPath(agent)}`) || r.stdout.includes(JSON.stringify(apiKeyPath(agent))));
	assert.equal(spawnSync(process.execPath, ["-e", `process.exit(require("fs").existsSync(${JSON.stringify(agent)}) ? 1 : 0)`]).status, 0, "dry run must not create the key");
	rmSync(parent, { recursive: true, force: true });
});

test("the server key: created once, reused, private on Linux and macOS", () => {
	const dir = mkdtempSync(join(tmpdir(), "agent-"));
	try {
		const path = apiKeyPath(dir);
		const key = ensureApiKey(path);
		assert.match(key, /^[0-9a-f]{64}$/);
		assert.equal(ensureApiKey(path), key);
		if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o077, 0, "the key file must not be readable by other users");
		assert.equal(piKey(dir), null, "no models.json yet");
		writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { "llama-cpp": { apiKey: key } } }));
		assert.equal(piKey(dir), key);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("with a key file, llama-server is told to require it", () => {
	const args = buildArgs(loadServerConfig(serverDir), { keyFile: "/x/llama-server.key" });
	assert.deepEqual(args.slice(args.indexOf("--api-key-file"), args.indexOf("--api-key-file") + 2), ["--api-key-file", "/x/llama-server.key"]);
});

test("--verify tells a protected server from an open one", async () => {
	const key = "k".repeat(64);
	// A stand-in for llama-server: 401 without the right bearer token, unless open.
	let open = false;
	const srv = createServer((req, res) => {
		res.statusCode = open || req.headers.authorization === `Bearer ${key}` ? 200 : 401;
		res.end("{}");
	});
	await new Promise((r) => srv.listen(0, "127.0.0.1", r));
	const cfg = { host: "127.0.0.1", port: srv.address().port };
	try {
		assert.deepEqual(await verifyKey(cfg, key), { url: `http://127.0.0.1:${cfg.port}/v1/models`, without: 401, with: 200 });
		open = true;
		assert.equal((await verifyKey(cfg, key)).without, 200);
	} finally {
		srv.close();
	}
	assert.equal((await verifyKey({ host: "127.0.0.1", port: cfg.port }, key)).without, null, "nothing listening");
});
