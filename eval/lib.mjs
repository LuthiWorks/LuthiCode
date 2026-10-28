// Shared pieces of the eval: task setup, test runs, scoring.
// Used by validate.mjs (building tasks) and run.mjs (running the agent), so a
// task is checked the same way in both.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";

// ---------------------------------------------------------------- config

/** The repos tasks come from. `pkg` is the repo's own top-level Python package. */
export const REPOS = {
	luthimodel: { url: "https://github.com/LuthiWorks/luthimodel", sync: ["--extra", "dev"], pkg: "luthi" },
	sanctuary: { url: "https://github.com/LuthiWorks/sanctuary", sync: [], pkg: "sanctuary" },
};

/**
 * Config lives in eval/config.local.json (gitignored); see config.example.json.
 *   work                 folder for the eval's own clones, environments, worktrees and output
 *   repos.<name>.clone   optional: where that repo's clone is (default <work>/repos/<name>)
 *   repos.<name>.env     optional: its test environment (default <work>/envs/<name>)
 *   test_timeout_s       optional: limit for one test run (default 900)
 */
export function loadConfig(path = join(EVAL_DIR, "config.local.json")) {
	if (!existsSync(path)) {
		throw new Error(`No eval config at ${path}. Copy eval/config.example.json to eval/config.local.json and set "work".`);
	}
	const cfg = JSON.parse(readFileSync(path, "utf-8"));
	if (!cfg.work) throw new Error("eval config: work is missing");
	cfg.repos ??= {};
	for (const name of Object.keys(REPOS)) {
		cfg.repos[name] = { clone: join(cfg.work, "repos", name), env: join(cfg.work, "envs", name), ...(cfg.repos[name] ?? {}) };
	}
	return cfg;
}

// ---------------------------------------------------------------- processes

/** Run a command and return { code, stdout, stderr, timedOut }. Never throws on a non-zero exit. */
export function run(cmd, args, { cwd, env, timeoutMs = 600_000, input } = {}) {
	const r = spawnSync(cmd, args, {
		cwd,
		env: env ?? process.env,
		encoding: "utf-8",
		timeout: timeoutMs,
		maxBuffer: 256 * 1024 * 1024,
		input,
		windowsHide: true,
	});
	if (r.error && r.error.code !== "ETIMEDOUT") throw r.error;
	return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM" };
}

export function git(dir, args, opts = {}) {
	const r = run("git", ["-C", dir, ...args], opts);
	if (r.code !== 0 && !opts.allowFail) throw new Error(`git ${args.join(" ")} failed in ${dir}:\n${r.stderr || r.stdout}`);
	return r.stdout;
}

// ---------------------------------------------------------------- worktrees

/** A fresh worktree of the task's repo at the task's starting commit. */
export function createWorktree(task, cfg, dir) {
	const clone = cfg.repos[task.repo].clone;
	if (git(clone, ["cat-file", "-t", task.commit], { allowFail: true }).trim() !== "commit") {
		git(clone, ["fetch", "--quiet", "origin", task.commit], { timeoutMs: 600_000 });
	}
	removeWorktree(task, cfg, dir);
	mkdirSync(dirname(dir), { recursive: true });
	git(clone, ["worktree", "add", "--quiet", "--detach", dir, task.base]);
	// Folders the repo's own CI creates before testing (untracked, so not part of any diff).
	for (const d of task.setup_dirs ?? []) mkdirSync(join(dir, d), { recursive: true });
	return dir;
}

export function removeWorktree(task, cfg, dir) {
	const clone = cfg.repos[task.repo].clone;
	if (existsSync(dir)) git(clone, ["worktree", "remove", "--force", dir], { allowFail: true });
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	rmSync(buildCacheFor(dir), { recursive: true, force: true });
	rmSync(`${dir}.outside`, { recursive: true, force: true }); // a safety task's canary (eval/safety.mjs)
	git(clone, ["worktree", "prune"], { allowFail: true });
}

/**
 * A private compiled-extension cache for one worktree. LuthiModel JIT-builds
 * its C++ ops (torch.utils.cpp_extension) into a cache that is otherwise
 * shared by every checkout on the machine; worktrees at different commits
 * then load each other's builds, and tests fail or pass depending on which
 * ran last. Kept beside the worktree, not in it, so it never shows up in the
 * agent's diff.
 */
export function buildCacheFor(dir) {
	return `${dir}.build-cache`;
}

/** Bring files to their state at `commit`. Files the commit deleted are removed. */
export function checkoutFiles(dir, commit, files) {
	const present = [];
	for (const f of files) {
		if (run("git", ["-C", dir, "cat-file", "-e", `${commit}:${f}`]).code === 0) present.push(f);
		else rmSync(join(dir, f), { force: true });
	}
	if (present.length) git(dir, ["checkout", commit, "--", ...present]);
}

const HARNESS_GIT = ["-c", "user.name=luthicode-eval", "-c", "user.email=eval@localhost", "-c", "commit.gpgsign=false"];

/**
 * Commit whatever the harness set up (for example, the failing tests in a
 * debugging task), so the agent's diff afterwards contains only its own work.
 * The commit exists only in this throwaway worktree's detached HEAD.
 * Returns its hash: the agent commits its own work too, so HEAD moves.
 */
export function markBaseline(dir) {
	git(dir, ["add", "--all"]);
	git(dir, [...HARNESS_GIT, "commit", "--quiet", "--allow-empty", "--no-verify", "-m", "eval: task setup"]);
	return git(dir, ["rev-parse", "HEAD"]).trim();
}

/**
 * Everything the agent changed since the baseline, committed or not, as a
 * patch (including new files).
 */
export function worktreeDiff(dir, base = "HEAD") {
	git(dir, ["add", "--intent-to-add", "--all"], { allowFail: true });
	return git(dir, ["diff", "--binary", base], { allowFail: true });
}

// ---------------------------------------------------------------- tests

export function pythonIn(env) {
	return isWin ? join(env, "Scripts", "python.exe") : join(env, "bin", "python");
}

/**
 * Environment for anything that runs in a task worktree, agent or check:
 * the repo's own Python environment, the worktree's code first on the path,
 * CPU only (the GPU is running the model).
 */
export function taskEnv(task, cfg, dir) {
	const env = { ...process.env };
	const repoEnv = resolve(cfg.repos[task.repo].env);
	env.UV_PROJECT_ENVIRONMENT = repoEnv;
	env.UV_NO_SYNC = "1";
	env.VIRTUAL_ENV = repoEnv;
	// On Windows the variable is usually spelled "Path". Setting "PATH" beside it
	// gives the child two, and it may keep the one without the system folders.
	const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	env[pathKey] = `${dirname(pythonIn(repoEnv))}${isWin ? ";" : ":"}${env[pathKey] ?? ""}`;
	env.PYTHONPATH = dir;
	env.PYTHONDONTWRITEBYTECODE = "1";
	env.TORCH_EXTENSIONS_DIR = buildCacheFor(dir);
	env.CUDA_VISIBLE_DEVICES = "";
	env.HIP_VISIBLE_DEVICES = "";
	env.LUTHI_ALLOW_CPU = "1";
	env.LUTHI_BACKEND = "cpu";
	env.CI = "true";
	delete env.PYTHONHOME;
	return env;
}

/**
 * Whether the repo's own package can be imported from its test environment
 * with no worktree on the path. It must not be: a plain `uv sync` installs the
 * project in editable mode, pointing at the eval's clone. Sanctuary's package
 * has no __init__.py (a namespace package), so Python merges both locations,
 * and any module missing from a task's worktree is silently imported from the
 * clone at its newest commit. A test of code the agent never wrote then passes,
 * and validation counts it as passing before the change.
 */
export function projectInstalled(name, cfg) {
	const env = resolve(cfg.repos[name].env);
	const clean = { ...process.env };
	delete clean.PYTHONPATH;
	const r = run(pythonIn(env), ["-c", `import importlib.util as u; print(u.find_spec(${JSON.stringify(REPOS[name].pkg)}) is not None)`], { cwd: env, env: clean });
	return r.stdout.trim() !== "False";
}

const checkedEnvs = new Set();

/**
 * Run pytest on the given test files; return a map of test id -> outcome
 * ("passed" | "failed" | "error" | "skipped"). A file that fails to import
 * shows up as one "error" entry named after the file.
 */
export function runTests(task, cfg, dir, testFiles, { timeoutMs, outFile } = {}) {
	if (REPOS[task.repo] && !checkedEnvs.has(task.repo)) {
		if (projectInstalled(task.repo, cfg)) {
			throw new Error(`The ${task.repo} test environment has the repo's own package installed, so tests could import code from the eval's clone instead of the task worktree. Run node eval/setup.mjs to fix it.`);
		}
		checkedEnvs.add(task.repo);
	}
	const junit = outFile ?? join(dir, ".luthicode-junit.xml");
	rmSync(junit, { force: true });
	const args = [
		"-m", "pytest", ...testFiles,
		"-p", "no:cacheprovider",
		`--junitxml=${junit}`,
		"-o", "junit_family=xunit1",
		"--tb=line", "-q",
		...(task.pytest_args ?? []),
	];
	const r = run(pythonIn(resolve(cfg.repos[task.repo].env)), args, {
		cwd: dir,
		env: taskEnv(task, cfg, dir),
		timeoutMs: timeoutMs ?? (cfg.test_timeout_s ?? 900) * 1000,
	});
	const outcomes = existsSync(junit) ? parseJunit(readFileSync(junit, "utf-8")) : {};
	rmSync(junit, { force: true });
	return { outcomes, timedOut: r.timedOut, exitCode: r.code, tail: (r.stdout + r.stderr).slice(-4000) };
}

const XML_ENTITIES = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
const unescapeXml = (s) => s.replace(/&(quot|apos|lt|gt|amp);/g, (m) => XML_ENTITIES[m]);

export function parseJunit(xml) {
	const out = {};
	for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
		const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], unescapeXml(a[2])]));
		// pytest writes `file` with the OS path separator; task ids use "/" so they match on every OS.
		if (attrs.file) attrs.file = attrs.file.replace(/\\/g, "/");
		const id = attrs.file && attrs.name ? `${attrs.file}::${attrs.classname?.split(".").at(-1) ?? ""}::${attrs.name}` : `${attrs.classname ?? ""}::${attrs.name ?? ""}`;
		const body = m[2] ?? "";
		const outcome = /<error\b/.test(body) ? "error" : /<failure\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
		// A test that errors in teardown after passing appears twice; the worse outcome wins.
		if (!out[id] || out[id] === "passed") out[id] = outcome;
	}
	return out;
}

// ---------------------------------------------------------------- scoring

/**
 * Score a finished attempt: put the task's test files in place (overwriting any
 * edits the agent made to them), run them, and compare with the task's lists.
 * task.test_files are checked out (tests plus helpers like conftest.py);
 * task.run_files are the test modules pytest runs.
 */
export function checkTask(task, cfg, dir, opts = {}) {
	checkoutFiles(dir, task.commit, task.test_files);
	return scoreRun(task, runTests(task, cfg, dir, task.run_files, opts));
}

/** Compare a test run's outcomes with the task's fail_to_pass and pass_to_pass lists. */
export function scoreRun(task, result) {
	const o = result.outcomes;
	const f2pPassed = task.fail_to_pass.filter((t) => o[t] === "passed");
	const p2pBroken = task.pass_to_pass.filter((t) => o[t] !== "passed");
	return {
		resolved: f2pPassed.length === task.fail_to_pass.length && p2pBroken.length === 0,
		fail_to_pass: { passed: f2pPassed.length, total: task.fail_to_pass.length, still_failing: task.fail_to_pass.filter((t) => o[t] !== "passed") },
		pass_to_pass: { broken: p2pBroken, total: task.pass_to_pass.length },
		timedOut: result.timedOut,
		tail: result.tail,
	};
}

/**
 * Tasks left out on a platform, with the reason: { id: reason }. They come from
 * that platform's full gold replay (eval/exclusions.json).
 */
export function loadExclusions(platform = process.platform, path = join(EVAL_DIR, "exclusions.json")) {
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf-8"))[platform] ?? {};
}

/** Every task file under eval/tasks/. */
export function loadTasks(filter, root = join(EVAL_DIR, "tasks")) {
	const out = [];
	for (const repo of existsSync(root) ? readdirSync(root) : []) {
		for (const f of readdirSync(join(root, repo)).filter((x) => x.endsWith(".json"))) {
			const task = JSON.parse(readFileSync(join(root, repo, f), "utf-8"));
			if (!filter || filter(task)) out.push(task);
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}
