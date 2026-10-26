// End-to-end check of protect-paths inside a real Pi process.
//
// A scripted fake model server stands in for llama-server and asks Pi to:
//   1. write a Sanctuary journal file      -> must be blocked
//   2. run `rm -rf data`                    -> must be blocked
//   3. write an ordinary source file        -> must succeed
// It then checks the files on disk and what Pi reported back to the "model".
//
// Needs Pi installed (no real model, no GPU). Run from the repo root:
//   node extensions/tests/protect-paths.e2e.mjs
// Set PI_BIN if `pi` isn't on PATH. Exit code 0 means every check passed.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "..", "protect-paths.ts");
const piBin = process.env.PI_BIN ?? "pi";

// ---- a throwaway Sanctuary checkout and Pi config ----

const root = mkdtempSync(join(tmpdir(), "luthicode-e2e-"));
const repo = join(root, "sanctuary-checkout");
const agentDir = join(root, "pi-agent");
mkdirSync(join(repo, "sanctuary", "core"), { recursive: true });
mkdirSync(join(repo, "sanctuary", "data", "journal"), { recursive: true });
mkdirSync(join(repo, "data", "identity"), { recursive: true });
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(repo, "pyproject.toml"), '[project]\nname = "sanctuary"\n');
writeFileSync(join(repo, "data", "identity", "charter.md"), "seed\n");

// ---- the scripted model ----

const steps = [
	{ tool: "write", args: { path: "sanctuary/data/journal/day.json", content: "{}" } },
	{ tool: "bash", args: { command: "rm -rf data" } },
	{ tool: "write", args: { path: "sanctuary/core/ok.py", content: "x = 1\n" } },
	{ text: "done" },
];
const requests = [];

function sse(res, chunks) {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
	res.write("data: [DONE]\n\n");
	res.end();
}

const server = createServer((req, res) => {
	let body = "";
	req.on("data", (d) => (body += d));
	req.on("end", () => {
		if (!req.url.endsWith("/chat/completions")) {
			res.writeHead(404).end();
			return;
		}
		const parsed = JSON.parse(body || "{}");
		requests.push(parsed);
		const step = steps[Math.min(requests.length - 1, steps.length - 1)];
		const base = { id: `r${requests.length}`, object: "chat.completion.chunk", created: 0, model: "fake" };
		if (step.tool) {
			const call = { index: 0, id: `call_${requests.length}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } };
			const chunks = [
				{ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
				{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
			];
			if (parsed.stream === false) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [call] }, finish_reason: "tool_calls" }] }));
			} else sse(res, chunks);
		} else {
			sse(res, [
				{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: step.text }, finish_reason: null }] },
				{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
			]);
		}
	});
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

writeFileSync(
	join(agentDir, "models.json"),
	JSON.stringify({
		providers: {
			fake: {
				baseUrl: `http://127.0.0.1:${port}/v1`,
				api: "openai-completions",
				apiKey: "local",
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
				models: [{ id: "fake", name: "Fake", input: ["text"], reasoning: false, contextWindow: 32768, maxTokens: 1024 }],
			},
		},
	}),
);
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake", defaultThinkingLevel: "off" }));

// ---- run Pi ----

// E2E_NO_GUARD=1 runs the same scenario without the guard, as a control:
// the protected checks should then FAIL, proving the protection is the guard's.
const guardArgs = process.env.E2E_NO_GUARD === "1" ? [] : ["-e", extension];
const isWin = process.platform === "win32";
// On Windows `pi` is a .cmd shim, so it runs through the shell; quote anything with spaces.
const q = (a) => (isWin && /\s/.test(a) ? `"${a}"` : a);
const child = spawn(q(piBin), ["-p", "Do the task.", ...guardArgs, "--no-session", "--no-context-files", "--offline"].map(q), {
	cwd: repo,
	env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	shell: isWin,
	// Pi reads piped stdin as extra prompt text in print mode; give it none.
	stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const code = await new Promise((r) => {
	const timer = setTimeout(() => {
		child.kill();
		r("timeout");
	}, 90_000);
	child.on("close", (c) => {
		clearTimeout(timer);
		r(c);
	});
});
server.close();

// ---- checks ----

function toolResultAfter(n) {
	const msgs = requests[n]?.messages ?? [];
	const tool = [...msgs].reverse().find((m) => m.role === "tool");
	if (!tool) return "";
	return typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content);
}

const checks = [
	["Pi exited normally", code === 0],
	["the model was called once per step", requests.length === steps.length],
	["protected journal file was not created", !existsSync(join(repo, "sanctuary", "data", "journal", "day.json"))],
	["Pi told the model the write was blocked", /protect-paths blocked/.test(toolResultAfter(1))],
	["data/ survived `rm -rf data`", existsSync(join(repo, "data", "identity", "charter.md"))],
	["Pi told the model the shell command was blocked", /protect-paths blocked/.test(toolResultAfter(2))],
	["ordinary source file was written", existsSync(join(repo, "sanctuary", "core", "ok.py")) && readFileSync(join(repo, "sanctuary", "core", "ok.py"), "utf-8") === "x = 1\n"],
	["the allowed write was not reported as blocked", !/protect-paths blocked/.test(toolResultAfter(3))],
];

let failed = 0;
for (const [name, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) failed++;
}
if (failed) {
	console.log(`\nPi exit code: ${code}\nPi output:\n${out.slice(-3000)}`);
	console.log(`\nRequests seen: ${requests.length}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed. Scratch dir: ${root}`);
process.exit(failed ? 1 : 0);
