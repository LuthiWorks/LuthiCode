// Tests for extensions/run-tests.ts. No model server needed.
// Run: node --test extensions/tests/run-tests.test.ts   (Node 22.18+)
// The integration tests need git and uv (they build small Python projects and
// install pytest); they are skipped when uv isn't on PATH.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import runTestsExtension, { BOOTSTRAP, caseKey, normalizeTargets, parseJunit, report, runPytest, type RunResult } from "../run-tests.ts";

const isWin = process.platform === "win32";
const hasUv = spawnSync(isWin ? "where" : "which", ["uv"]).status === 0;

// ---- targets ------------------------------------------------------------------

test("targets: repo-relative, test ids kept", () => {
	const root = join(tmpdir(), "repo");
	assert.deepEqual(normalizeTargets(root, root, ["tests/test_a.py::test_x", "tests"]), ["tests/test_a.py::test_x", "tests"]);
	assert.deepEqual(normalizeTargets(root, join(root, "tests"), ["test_a.py"]), ["tests/test_a.py"]);
});

test("targets: pytest options are refused (--basetemp deletes folders)", () => {
	const root = join(tmpdir(), "repo");
	assert.throws(() => normalizeTargets(root, root, ["--basetemp=data/identity"]), /pytest option/);
	assert.throws(() => normalizeTargets(root, root, ["-p", "x"]), /pytest option/);
});

test("targets: outside the repo, or none, is refused", () => {
	const root = join(tmpdir(), "repo");
	assert.throws(() => normalizeTargets(root, root, ["../other/tests"]), /outside this repo/);
	assert.throws(() => normalizeTargets(root, root, []), /at least one/);
	assert.throws(() => normalizeTargets(root, root, ["  "]), /Empty/);
});

// ---- junit ----------------------------------------------------------------------

test("test ids: module-level, class, nested class, no file", () => {
	assert.equal(caseKey("tests/test_calc.py", "tests.test_calc", "test_mul"), "tests/test_calc.py::test_mul");
	assert.equal(caseKey("tests/test_calc.py", "tests.test_calc.TestOps", "test_mul[2-3]"), "tests/test_calc.py::TestOps::test_mul[2-3]");
	assert.equal(caseKey("tests\\test_calc.py", "tests.test_calc.TestA.TestB", "t"), "tests/test_calc.py::TestA::TestB::t");
	assert.equal(caseKey(undefined, "tests.test_calc", ""), "tests.test_calc::");
});

test("junit: outcomes, messages, entities, teardown duplicates", () => {
	const xml = `<testsuite>
<testcase classname="tests.test_a" name="test_ok" file="tests/test_a.py" />
<testcase classname="tests.test_a" name="test_bad" file="tests/test_a.py"><failure message="assert 1 == 2">E   assert 1 &lt; 2 &amp;&amp; ok</failure></testcase>
<testcase classname="tests.test_a" name="test_err" file="tests/test_a.py"><error message="ImportError">trace</error></testcase>
<testcase classname="tests.test_a" name="test_skip" file="tests/test_a.py"><skipped message="no gpu" /></testcase>
<testcase classname="tests.test_a" name="test_td" file="tests/test_a.py" />
<testcase classname="tests.test_a" name="test_td" file="tests/test_a.py"><error message="teardown">x</error></testcase>
</testsuite>`;
	const by = Object.fromEntries(parseJunit(xml).map((c) => [c.key, c]));
	assert.equal(by["tests/test_a.py::test_ok"].outcome, "passed");
	assert.equal(by["tests/test_a.py::test_bad"].outcome, "failed");
	assert.match(by["tests/test_a.py::test_bad"].message, /assert 1 == 2[\s\S]*assert 1 < 2 && ok/);
	assert.equal(by["tests/test_a.py::test_err"].outcome, "error");
	assert.equal(by["tests/test_a.py::test_skip"].outcome, "skipped");
	assert.equal(by["tests/test_a.py::test_td"].outcome, "error");
});

// ---- report ---------------------------------------------------------------------

const run = (cases: RunResult["cases"]): RunResult => ({ cases, timedOut: false, exitCode: 1, output: "", seconds: 1.5 });

test("report: failures are split into new and already failing", () => {
	const r = run([
		{ key: "t.py::a", outcome: "passed", message: "" },
		{ key: "t.py::b", outcome: "failed", message: "boom" },
		{ key: "t.py::c", outcome: "failed", message: "old boom" },
	]);
	const { text, details } = report(r, new Map([["t.py::b", "passed"], ["t.py::c", "failed"]]));
	assert.match(text, /1 passed, 2 failed/);
	assert.match(text, /New failures \(1\):\n- t\.py::b\n {4}boom/);
	assert.match(text, /Already failing before you started \(1\)[^\n]*\n- t\.py::c/);
	assert.doesNotMatch(text, /old boom/);
	assert.deepEqual(details.new_failures, ["t.py::b"]);
	assert.deepEqual(details.old_failures, ["t.py::c"]);
});

test("report: without a baseline, failures aren't labeled new", () => {
	const { text } = report(run([{ key: "t.py::b", outcome: "error", message: "e" }]), null);
	assert.match(text, /Failures \(1\):/);
	assert.doesNotMatch(text, /New failures/);
});

test("report: long output is cut, and says so", () => {
	const cases = Array.from({ length: 200 }, (_, i) => ({ key: `t.py::test_${i}`, outcome: "failed" as const, message: "x".repeat(2000) }));
	const { text } = report(run(cases), new Map());
	assert.ok(text.length < 7000, `report is ${text.length} chars`);
	assert.match(text, /more lines cut/);
});

test("report: no results shows pytest's own output", () => {
	const r = { ...run([]), output: "ERROR: file or directory not found: tests/nope.py" };
	assert.match(report(r, null).text, /No test results[\s\S]*not found: tests\/nope\.py/);
});

// ---- integration ------------------------------------------------------------------

function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", env: env ?? process.env });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr}${r.stdout}`);
	return r.stdout.trim();
}

function venvWithPytest(dir: string): string {
	sh("uv", ["venv", "-q", dir], tmpdir());
	const python = isWin ? join(dir, "Scripts", "python.exe") : join(dir, "bin", "python");
	sh("uv", ["pip", "install", "-q", "--python", python, "pytest"], tmpdir());
	return python;
}

function gitRepo(dir: string, files: Record<string, string>) {
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(dir, rel, ".."), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}
	sh("git", ["init", "-q", "-b", "main"], dir);
	sh("git", ["add", "-A"], dir);
	sh("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "start"], dir);
}

test("integration: a new failure and an old one are told apart", { skip: !hasUv && "needs uv" }, async () => {
	const root = mkdtempSync(join(tmpdir(), "run-tests-"));
	try {
		const venv = join(root, "venv");
		venvWithPytest(venv);
		const repo = join(root, "toy");
		mkdirSync(repo);
		gitRepo(repo, {
			"toypkg/__init__.py": "",
			"toypkg/calc.py": "def add(a, b):\n    return a + b\n",
			// Already broken when the session starts: add(1, 1) is 2, not 3.
			"tests/test_calc.py": "from toypkg.calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_old_bug():\n    assert add(1, 1) == 3\n",
		});
		// The tool as Pi would load it.
		const tools: any[] = [];
		const handlers: Record<string, Function> = {};
		runTestsExtension({ on: (e: string, h: Function) => (handlers[e] = h), registerTool: (t: any) => tools.push(t) } as any);
		const prevVenv = process.env.VIRTUAL_ENV;
		process.env.VIRTUAL_ENV = venv;
		try {
			await handlers.session_start({}, { cwd: repo });
			// The agent breaks add() after the session started.
			writeFileSync(join(repo, "toypkg/calc.py"), "def add(a, b):\n    return a - b\n");
			const res = await tools[0].execute("1", { paths: ["tests/test_calc.py"] }, undefined, undefined, { cwd: repo });
			const text = res.content[0].text;
			assert.match(text, /0 passed, 2 failed/);
			assert.match(text, /New failures \(1\):\n- tests\/test_calc\.py::test_add/);
			assert.match(text, /Already failing before you started \(1\)[^\n]*\n- tests\/test_calc\.py::test_old_bug/);
			// The baseline worktree is cleaned up, and the agent's change is untouched.
			assert.equal(sh("git", ["worktree", "list"], repo).split("\n").length, 1);
			assert.match(sh("git", ["status", "--short"], repo), /M toypkg\/calc\.py/);
			// An option is refused before anything runs.
			await assert.rejects(tools[0].execute("2", { paths: ["--basetemp=toypkg"] }, undefined, undefined, { cwd: repo }), /pytest option/);
		} finally {
			if (prevVenv === undefined) delete process.env.VIRTUAL_ENV;
			else process.env.VIRTUAL_ENV = prevVenv;
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("integration: code is never imported from an editable install elsewhere", { skip: !hasUv && "needs uv" }, async () => {
	// The trap from the eval build (docs/research/2026-10-26_eval-build.md, step 11):
	// a namespace package, installed editable from checkout A. In checkout B a module
	// is missing; plain pytest quietly imports it from A. run_tests must not.
	const root = mkdtempSync(join(tmpdir(), "run-tests-ns-"));
	try {
		const a = join(root, "a");
		mkdirSync(a);
		gitRepo(a, {
			"pyproject.toml": '[project]\nname = "nsdemo"\nversion = "0"\n[build-system]\nrequires = ["setuptools>=64"]\nbuild-backend = "setuptools.build_meta"\n[tool.setuptools.packages.find]\nwhere = ["."]\ninclude = ["nsdemo*"]\nnamespaces = true\n',
			"nsdemo/core.py": "VALUE = 1\n",
			"nsdemo/extra.py": "VALUE = 2\n",
			"tests/test_extra.py": "from nsdemo.extra import VALUE\n\n\ndef test_extra():\n    assert VALUE == 2\n",
		});
		const python = venvWithPytest(join(root, "venv"));
		sh("uv", ["pip", "install", "-q", "--python", python, "-e", a], root);
		const b = join(root, "b");
		cpSync(a, b, { recursive: true });
		rmSync(join(b, "nsdemo", "extra.py"));

		// Control: plain pytest in B passes, importing extra.py from A. The leak is real.
		const plain = spawnSync(python, ["-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_extra.py"], { cwd: b, encoding: "utf-8" });
		assert.equal(plain.status, 0, `control should pass through the leak:\n${plain.stdout}`);

		// run_tests' runner in B: the missing module stays missing.
		const r = await runPytest("python", python, b, ["tests/test_extra.py"], 120);
		assert.ok(r.cases.length > 0, r.output);
		assert.ok(r.cases.every((c) => c.outcome !== "passed"), `should fail in B:\n${r.output}`);
		assert.match(r.output, /No module named 'nsdemo\.extra'/);

		// And in A, where the module exists, it passes.
		const ok = await runPytest("python", python, a, ["tests/test_extra.py"], 120);
		assert.deepEqual(ok.cases.map((c) => c.outcome), ["passed"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("bootstrap is plain Python with no stray JavaScript", () => {
	assert.doesNotMatch(BOOTSTRAP, /\$\{|=>/);
	assert.match(BOOTSTRAP, /pytest\.main/);
});
