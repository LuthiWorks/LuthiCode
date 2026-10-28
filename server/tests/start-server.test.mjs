// Tests for server/start-server.mjs. No model, no GPU, no llama.cpp needed.
// Run: node --test server/tests/start-server.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArgs, defaultLlamaDir, findServer, loadServerConfig } from "../start-server.mjs";

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

test("--dry-run prints the full command on this platform", () => {
	const r = spawnSync(process.execPath, [join(serverDir, "start-server.mjs"), "--dry-run"], { encoding: "utf-8" });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /llama-server/);
	assert.match(r.stdout, /--ctx-size 65536/);
	assert.match(r.stdout, /enable_thinking/);
});
