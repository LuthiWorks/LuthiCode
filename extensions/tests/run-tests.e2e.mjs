// End-to-end check of run_tests inside a real Pi process, with protect-paths loaded.
//
// A scripted model asks Pi to run a test file whose name contains "charter".
// Checks: Pi loads the extension and accepts its schema; the guard doesn't
// mistake a test target for a write to a protected file; the report reaches the
// model; and a pytest option is refused.
//
// Needs Pi, git and uv (no real model, no GPU). Run from the repo root:
//   node extensions/tests/run-tests.e2e.mjs
// Set PI_BIN if `pi` isn't on PATH. Exit code 0 means every check passed.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeModel, toolResultBefore } from "../../eval/tests/fake-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ext = (n) => resolve(here, "..", `${n}.ts`);
const piBin = process.env.PI_BIN ?? "pi";
const isWin = process.platform === "win32";

function sh(cmd, args, cwd) {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}:\n${r.stderr}${r.stdout}`);
	return r.stdout.trim();
}

// ---- a toy Sanctuary-like repo with a test file named like the charter ----

const root = mkdtempSync(join(tmpdir(), "run-tests-e2e-"));
const repo = join(root, "repo");
mkdirSync(join(repo, "loader"), { recursive: true });
mkdirSync(join(repo, "tests"), { recursive: true });
writeFileSync(join(repo, "loader", "__init__.py"), "def seeds():\n    return ['Honesty', 'Care']\n");
writeFileSync(join(repo, "tests", "test_charter_loader.py"), "from loader import seeds\n\n\ndef test_seeds():\n    assert 'Care' in seeds()\n");
sh("git", ["init", "-q", "-b", "main"], repo);
sh("git", ["add", "-A"], repo);
sh("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "start"], repo);
const venv = join(root, "venv");
sh("uv", ["venv", "-q", venv], root);
sh("uv", ["pip", "install", "-q", "--python", isWin ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python"), "pytest"], root);

// ---- the scripted model ----

const fake = await startFakeModel([
	{ tool: "run_tests", args: { paths: ["tests/test_charter_loader.py"] } },
	{ tool: "run_tests", args: { paths: ["--basetemp=tests"] } },
	{ text: "done" },
]);
const agentDir = join(root, "agent");
fake.writeAgentDir(agentDir);

const code = await new Promise((done) => {
	const args = ["--mode", "json", "--no-session", "--provider", "fake", "--model", "fake", "--no-extensions", "-e", ext("protect-paths"), "-e", ext("run-tests")];
	const child = spawn(piBin, args, {
		cwd: repo,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, VIRTUAL_ENV: venv },
		shell: isWin,
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stdin.end("Run the charter loader tests.");
	let out = "";
	child.stdout.on("data", (d) => (out += d));
	child.stderr.on("data", (d) => (out += d));
	child.on("close", (c) => {
		if (c !== 0) console.log(out.slice(-3000));
		done(c);
	});
});
await fake.close();

const first = toolResultBefore(fake.requests, 2);
const second = toolResultBefore(fake.requests, 3);
const checks = [
	["Pi exited cleanly", code === 0],
	["the guard didn't block the test target", !/protect-paths blocked/.test(first)],
	["the report reached the model", /1 passed, 0 failed/.test(first)],
	["a pytest option was refused", /looks like a pytest option/.test(second)],
	["the tests folder survived the --basetemp attempt", spawnSync("git", ["status", "--short"], { cwd: repo, encoding: "utf-8" }).stdout.trim() === ""],
];
let failed = 0;
for (const [name, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) failed++;
}
if (failed) console.log(`\nfirst result: ${first}\nsecond result: ${second}\nScratch kept: ${root}`);
else rmSync(root, { recursive: true, force: true });
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exit(failed ? 1 : 0);
