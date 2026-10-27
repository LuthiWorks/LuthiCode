// End-to-end check of the eval runner, with a scripted fake model instead of
// the real one. Needs Pi, git and uv; no GPU, no model server.
//
//   node eval/tests/runner.e2e.mjs
//
// It builds a tiny git repo whose last commit adds a function and its test,
// turns that commit into a task, and runs eval/run.mjs four ways:
//   gold      the fake model writes the real fix           -> resolved
//   nothing   the fake model just says it's done           -> not resolved
//   blocked   it first tries to write outside the worktree -> guard block counted, then resolved
//   debug     debugging seat: the prompt must carry the failing test output
// Exit code 0 means every check passed.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeModel, toolResultBefore } from "./fake-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = resolve(here, "..", "run.mjs");
const root = mkdtempSync(join(here, ".e2e-"));
const sh = (cmd, args, cwd) => {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
	return r.stdout.trim();
};

// ---- a tiny repo: base has add(); the task's commit adds mul() and its test ----

const repo = join(root, "toy");
mkdirSync(join(repo, "toypkg"), { recursive: true });
mkdirSync(join(repo, "tests"), { recursive: true });
sh("git", ["init", "-q", "-b", "main"], repo);
sh("git", ["config", "user.email", "t@example.com"], repo);
sh("git", ["config", "user.name", "t"], repo);
writeFileSync(join(repo, "pyproject.toml"), '[project]\nname = "toypkg"\nversion = "0"\n');
writeFileSync(join(repo, "toypkg", "__init__.py"), "");
writeFileSync(join(repo, "toypkg", "calc.py"), "def add(a, b):\n    return a + b\n");
writeFileSync(join(repo, "tests", "test_calc.py"), "from toypkg.calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n");
sh("git", ["add", "-A"], repo);
sh("git", ["commit", "-q", "-m", "base"], repo);
const base = sh("git", ["rev-parse", "HEAD"], repo);
const fixed = "def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n";
writeFileSync(join(repo, "toypkg", "calc.py"), fixed);
writeFileSync(join(repo, "tests", "test_calc.py"), "from toypkg.calc import add, mul\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n");
sh("git", ["commit", "-q", "-am", "add mul"], repo);
const commit = sh("git", ["rev-parse", "HEAD"], repo);
// The runner fetches from origin/main history; the clone itself serves here.

// ---- a Python environment with pytest ----

const env = join(root, "env");
sh("uv", ["venv", "-q", env], root);
sh("uv", ["pip", "install", "-q", "--python", env, "pytest"], root);

// ---- task, config ----

const tasksDir = join(root, "tasks");
mkdirSync(join(tasksDir, "toy"), { recursive: true });
const task = {
	id: "toy-mul",
	repo: "toy",
	seat: "implementation",
	instruction: "Add a mul(a, b) function to toypkg/calc.py that multiplies its arguments.",
	commit,
	base,
	test_files: ["tests/test_calc.py"],
	run_files: ["tests/test_calc.py"],
	gold_files: ["toypkg/calc.py"],
	fail_to_pass: ["tests/test_calc.py::::test_mul"],
	pass_to_pass: ["tests/test_calc.py::::test_add"],
};
const cfgPath = join(root, "config.json");
writeFileSync(cfgPath, JSON.stringify({ repos: { toy: { clone: repo, env } }, work: join(root, "work") }));

// The test ids depend on pytest's junit output; take them from a real run so the
// task matches this machine's pytest.
{
	const { runTests, createWorktree, checkoutFiles, removeWorktree } = await import("../lib.mjs");
	const cfg = { repos: { toy: { clone: repo, env } }, work: join(root, "work") };
	const dir = join(root, "work", "probe");
	createWorktree(task, cfg, dir);
	checkoutFiles(dir, commit, task.test_files);
	checkoutFiles(dir, commit, task.gold_files);
	const ids = Object.keys(runTests(task, cfg, dir, task.run_files).outcomes);
	removeWorktree(task, cfg, dir);
	task.fail_to_pass = ids.filter((i) => i.endsWith("test_mul"));
	task.pass_to_pass = ids.filter((i) => i.endsWith("test_add"));
}
writeFileSync(join(tasksDir, "toy", "toy-mul.json"), JSON.stringify(task, null, 1));

// ---- the arms ----

const arms = {
	gold: [{ tool: "write", args: { path: "toypkg/calc.py", content: fixed } }, { text: "Added mul." }],
	nothing: [{ text: "Done." }],
	blocked: [
		{ tool: "write", args: { path: join(root, "outside.txt"), content: "x" } },
		{ tool: "write", args: { path: "toypkg/calc.py", content: fixed } },
		{ text: "Added mul." },
	],
	debug: [{ tool: "write", args: { path: "toypkg/calc.py", content: fixed } }, { text: "Fixed." }],
	// The agent commits its work (pi/AGENTS.global.md), so HEAD moves during the attempt.
	committed: [
		{ tool: "write", args: { path: "toypkg/calc.py", content: fixed } },
		{ tool: "bash", args: { command: "git add toypkg/calc.py && git -c user.name=t -c user.email=t@example.com commit -q -m 'Add mul' && git log -1 --format=%s" } },
		{ text: "Added and committed mul." },
	],
};

const results = {};
for (const [name, steps] of Object.entries(arms)) {
	const fake = await startFakeModel(steps);
	const agentDir = join(root, `agent-${name}`);
	fake.writeAgentDir(agentDir);
	// Asynchronous on purpose: the fake model server lives in this process and
	// must keep answering while the runner (and Pi under it) works.
	const r = await new Promise((done) => {
		const child = spawn(
			process.execPath,
			[runner, "--label", name, "--repeat", "1", "--provider", "fake", "--model", "fake", "--config", cfgPath, "--tasks-dir", tasksDir, "--results-dir", join(root, "results"), "--timeout-min", "3", ...(name === "debug" ? ["--seat", "debugging"] : [])],
			{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (status) => done({ status, stdout, stderr }));
	});
	await fake.close();
	const runDir = join(root, "work", "runs", name);
	const lines = readFileSync(join(runDir, "results.jsonl"), "utf-8").trim().split("\n");
	results[name] = { record: JSON.parse(lines.at(-1)), requests: fake.requests, out: r.stdout + r.stderr, code: r.status };
}

// ---- checks ----

const g = results.gold.record;
const n = results.nothing.record;
const b = results.blocked.record;
const d = results.debug.record;
const firstUser = (reqs) => JSON.stringify(reqs[0]?.messages?.filter((m) => m.role === "user") ?? "");
const checks = [
	["runner exited cleanly for every arm", Object.values(results).every((x) => x.code === 0)],
	["gold: resolved", g.resolved === true],
	["gold: one tool call counted", g.tool_calls === 1 && g.tools?.write === 1],
	["gold: fail_to_pass 1/1, nothing broken", g.fail_to_pass?.passed === 1 && g.pass_to_pass?.broken?.length === 0],
	["gold: tokens counted", g.output_tokens > 0],
	["gold: only protect-paths loaded", JSON.stringify(g.extensions) === '["protect-paths"]'],
	["gold: the prompt was the task's instruction", firstUser(results.gold.requests).includes("Add a mul(a, b) function")],
	["nothing: not resolved", n.resolved === false],
	["nothing: no changes recorded", n.diff_lines === 0],
	["nothing: mul still failing", n.fail_to_pass?.still_failing?.length === 1],
	["blocked: the outside write was blocked and counted", b.guard_blocks === 1],
	["blocked: nothing was written outside", !readdirSync(root).includes("outside.txt")],
	["blocked: still resolved afterwards", b.resolved === true],
	["debug: resolved", d.resolved === true],
	["debug: the harness's test setup isn't blamed on the agent", d.touched_tests?.length === 0 && d.diff_lines === 4],
	// The test file fails to import before the fix, so pytest reports the import error, not test_mul by name.
	["debug: the prompt carried the failing test output", /cannot import name 'mul'/.test(firstUser(results.debug.requests)) && !firstUser(results.debug.requests).includes("Add a mul(a, b)")],
	// The commit's subject comes back only if the commit really happened, so HEAD did move.
	["committed: the agent's commit went through", toolResultBefore(results.committed.requests, 3).includes("Add mul") && results.committed.record.guard_blocks === 0],
	["committed: resolved", results.committed.record.resolved === true],
	["committed: the committed work is still recorded as the agent's diff", results.committed.record.diff_lines > 0 && results.committed.record.diff_lines === g.diff_lines],
	["worktrees were cleaned up", readdirSync(join(root, "work", "wt")).every((l) => readdirSync(join(root, "work", "wt", l)).length === 0)],
	["a summary was written", readdirSync(join(root, "results")).some((f) => f.includes("_gold_implementation"))],
];

let failed = 0;
console.log("");
for (const [name, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) failed++;
}
if (failed) {
	for (const [name, x] of Object.entries(results)) console.log(`\n--- ${name} (exit ${x.code})\n${x.out.slice(-2000)}\n${JSON.stringify(x.record)}`);
	console.log(`\nScratch dir kept: ${root}`);
} else {
	rmSync(root, { recursive: true, force: true });
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
process.exit(failed ? 1 : 0);
