/**
 * run_tests: run the repo's own tests on CPU and report only the failures,
 * each marked as new or as already failing before the agent started.
 *
 * Why a tool instead of the shell: the agent otherwise reads whole pytest logs,
 * which cost context on every later turn, and it can't tell its own breakage
 * from failures that were there before it began (LuthiModel has a test that
 * fails on CPU by design). Phase 2, item 1 of docs/plan.md.
 *
 * How it works:
 * - Repo: LuthiModel (`luthi/`), Sanctuary (`sanctuary/`), or any Python repo.
 *   Tests run with the repo's own environment: VIRTUAL_ENV when set (the eval
 *   sets it), else the one `uv run` uses in the repo, else `python`.
 * - CPU only: the GPU belongs to the model server (LUTHI_ALLOW_CPU=1, and
 *   CUDA/HIP/ROCm devices hidden).
 * - The code under test always comes from the checkout being tested. A Python
 *   bootstrap removes editable installs of the project from the import system
 *   first: otherwise a module missing from a checkout is silently imported
 *   from wherever the project is installed (see docs/research/2026-10-26_eval-build.md,
 *   step 11).
 * - Before-you-started baseline: when the session starts, the repo's state is
 *   recorded (`git stash create`, which changes nothing). When tests fail, the
 *   same test files are run once at that state, in a temporary worktree, and
 *   each failure is labeled. Results are cached for the session.
 * - Arguments are test targets only: anything starting with "-" is refused
 *   (pytest options such as --basetemp delete folders), and targets must be
 *   inside the repo.
 *
 * Guard interaction: the tool declares readOnlyHint, so protect-paths doesn't
 * treat test paths as write targets (a test file named test_charter.py would
 * otherwise be blocked). It is no wider than running pytest through bash, which
 * the guard allows, and narrower in its arguments.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type RepoKind = "luthimodel" | "sanctuary" | "python";

export interface TestCase {
	key: string; // file::Class::name, stable across checkouts
	outcome: "passed" | "failed" | "error" | "skipped";
	message: string;
}

export interface RunResult {
	cases: TestCase[];
	timedOut: boolean;
	exitCode: number | null;
	output: string;
	seconds: number;
}

const isWin = process.platform === "win32";
const DEFAULT_TIMEOUT_S = 600;
const MAX_TIMEOUT_S = 3600;
const SANCTUARY_PER_TEST_TIMEOUT_S = 120;
const MAX_REPORT_CHARS = 6000;
const MAX_FAILURE_CHARS = 600;

// ---------------------------------------------------------------- repo and command

export function detectRepo(root: string): RepoKind {
	if (existsSync(join(root, "luthi", "__init__.py"))) return "luthimodel";
	if (existsSync(join(root, "sanctuary")) && existsSync(join(root, "pyproject.toml")) && /name\s*=\s*"sanctuary"/.test(readFileSync(join(root, "pyproject.toml"), "utf-8"))) return "sanctuary";
	return "python";
}

/**
 * Turn the agent's targets into repo-relative pytest targets. Throws with a
 * message for the agent when a target is an option or outside the repo.
 */
export function normalizeTargets(root: string, cwd: string, raw: string[]): string[] {
	if (!raw.length) throw new Error("Give at least one test file, folder or test id.");
	return raw.map((t) => {
		const target = t.trim();
		if (!target) throw new Error("Empty test target.");
		if (target.startsWith("-")) throw new Error(`"${t}" looks like a pytest option. run_tests takes test targets only (files, folders or test ids).`);
		const [file, ...rest] = target.split("::");
		const rel = relative(root, isAbsolute(file) ? file : resolve(cwd, file));
		if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`"${t}" is outside this repo.`);
		return [rel.split(sep).join("/") || ".", ...rest].join("::");
	});
}

/** pytest arguments for one run. */
export function pytestArgs(kind: RepoKind, targets: string[], junitPath: string): string[] {
	const args = [...targets, "-q", "-p", "no:cacheprovider", `--junitxml=${junitPath}`, "-o", "junit_family=xunit1", "--tb=short"];
	if (kind === "sanctuary") args.push(`--timeout=${SANCTUARY_PER_TEST_TIMEOUT_S}`);
	return args;
}

/**
 * Python run before pytest. It removes editable installs of any project from
 * the import system, then makes sure the current checkout is first on the path,
 * so the code under test comes only from that checkout.
 */
export const BOOTSTRAP = [
	"import glob, json, os, site, sys",
	"root = os.path.realpath(os.getcwd())",
	"mod = lambda o: getattr(o, '__module__', None) or type(o).__module__ or ''",
	"sys.meta_path[:] = [f for f in sys.meta_path if '__editable__' not in mod(f)]",
	"sys.path_hooks[:] = [h for h in sys.path_hooks if '__editable__' not in mod(h) and '__editable__' not in repr(h)]",
	"dirs = set()",
	"for sp in site.getsitepackages() + [site.getusersitepackages()]:",
	"    for pth in glob.glob(os.path.join(sp, '*editable*.pth')):",
	"        for line in open(pth, encoding='utf-8', errors='replace'):",
	"            line = line.strip()",
	"            if line and not line.startswith(('#', 'import')) and os.path.isdir(line):",
	"                dirs.add(os.path.realpath(line))",
	"keep = lambda p: '__editable__' not in p and (os.path.realpath(p or '.') == root or os.path.realpath(p or '.') not in dirs)",
	"sys.path[:] = [p for p in sys.path if keep(p)]",
	"sys.path.insert(0, root)",
	"sys.path_importer_cache.clear()",
	"import pytest",
	"sys.exit(pytest.main(json.loads(os.environ['LUTHICODE_PYTEST_ARGS'])))",
].join("\n");

const pythonCache = new Map<string, string>();

/**
 * The Python to test with: the repo's own environment, found once from the
 * main checkout and reused for the baseline worktree (which has no environment
 * of its own). VIRTUAL_ENV wins when set (the eval sets it).
 */
export function pythonFor(root: string): string {
	const venv = process.env.VIRTUAL_ENV;
	if (venv) {
		const p = isWin ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
		if (existsSync(p)) return p;
	}
	const cached = pythonCache.get(root);
	if (cached) return cached;
	let python = isWin ? "python" : "python3";
	if (existsSync(join(root, "pyproject.toml"))) {
		const r = spawnSync("uv", ["run", "--no-sync", "python", "-c", "import sys; print(sys.executable)"], { cwd: root, encoding: "utf-8", windowsHide: true });
		if (r.status === 0 && r.stdout.trim()) python = r.stdout.trim();
	}
	pythonCache.set(root, python);
	return python;
}

/** Environment for a test run: CPU only, the checkout's code first. */
export function testEnv(checkout: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.PYTHONPATH = [checkout, process.env.PYTHONPATH].filter((x) => x && x !== checkout).join(isWin ? ";" : ":");
	env.PYTHONDONTWRITEBYTECODE = "1";
	env.CUDA_VISIBLE_DEVICES = "";
	env.HIP_VISIBLE_DEVICES = "";
	env.ROCR_VISIBLE_DEVICES = "";
	env.LUTHI_ALLOW_CPU = "1";
	env.LUTHI_BACKEND = "cpu";
	return { ...env, ...extra };
}

// ---------------------------------------------------------------- running

function killTree(pid: number | undefined) {
	if (!pid) return;
	if (isWin) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
	else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
}

export function runPytest(kind: RepoKind, python: string, checkout: string, targets: string[], timeoutS: number, signal?: AbortSignal, extraEnv: Record<string, string> = {}): Promise<RunResult> {
	const scratch = mkdtempSync(join(tmpdir(), "luthicode-run-tests-"));
	const junit = join(scratch, "junit.xml");
	const cmd = python;
	const args = ["-c", BOOTSTRAP];
	const env = testEnv(checkout, { ...extraEnv, LUTHICODE_PYTEST_ARGS: JSON.stringify(pytestArgs(kind, targets, junit)) });
	const t0 = Date.now();
	return new Promise((done) => {
		const child = spawn(cmd, args, { cwd: checkout, env, detached: !isWin, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d) => chunks.push(d));
		child.stderr.on("data", (d) => chunks.push(d));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child.pid);
		}, timeoutS * 1000);
		const onAbort = () => killTree(child.pid);
		signal?.addEventListener("abort", onAbort, { once: true });
		const finish = (code: number | null, err?: Error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			let output = Buffer.concat(chunks).toString("utf-8");
			if (err) output += `\n${String(err)}`;
			const cases = existsSync(junit) ? parseJunit(readFileSync(junit, "utf-8")) : [];
			rmSync(scratch, { recursive: true, force: true });
			done({ cases, timedOut, exitCode: code, output, seconds: Math.round((Date.now() - t0) / 100) / 10 });
		};
		child.on("error", (e) => finish(null, e));
		child.on("close", (code) => finish(code));
	});
}

// ---------------------------------------------------------------- junit

const ENTITIES: Record<string, string> = { "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };
const unescape = (s: string) => s.replace(/&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (m) => {
	if (ENTITIES[m]) return ENTITIES[m];
	const n = m.startsWith("&#x") ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10);
	return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});

/** A pytest-style id for a junit test case: file::Class::name, or file::name. */
export function caseKey(file: string | undefined, classname: string, name: string): string {
	if (!file) return `${classname}::${name}`;
	const f = file.replace(/\\/g, "/");
	const module = f.replace(/\.py$/, "").split("/").join(".");
	const classPath = classname === module ? "" : classname.startsWith(module + ".") ? classname.slice(module.length + 1) : "";
	return [f, ...classPath.split(".").filter(Boolean), name].join("::");
}

export function parseJunit(xml: string): TestCase[] {
	const out = new Map<string, TestCase>();
	for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
		const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], unescape(a[2])]));
		const body = m[2] ?? "";
		const bad = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
		const outcome: TestCase["outcome"] = bad ? (bad[1] === "error" ? "error" : "failed") : /<skipped\b/.test(body) ? "skipped" : "passed";
		let message = "";
		if (bad) {
			const msg = bad[2].match(/message="([^"]*)"/)?.[1] ?? "";
			const text = unescape(bad[3] ?? "").trim();
			message = [unescape(msg), text.split("\n").slice(-12).join("\n")].filter(Boolean).join("\n");
		}
		const key = caseKey(attrs.file, attrs.classname ?? "", attrs.name ?? "");
		const prev = out.get(key);
		// A test that errors in teardown after passing appears twice; the worse outcome wins.
		if (!prev || prev.outcome === "passed") out.set(key, { key, outcome, message });
	}
	return [...out.values()];
}

// ---------------------------------------------------------------- baseline

export interface Baseline {
	root: string;
	ref: string | null; // the state when the session started; null outside git
	byFile: Map<string, Map<string, TestCase["outcome"]>>; // file -> key -> outcome at the start
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
	const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true });
	return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

/**
 * A path in its canonical form, so two spellings of one folder compare equal:
 * macOS temp folders are symlinks (/var -> /private/var), and Windows paths can
 * use 8.3 short names (RUNNER~1). git reports the canonical form.
 */
export function canonical(p: string): string {
	try {
		return realpathSync.native(p);
	} catch {
		return resolve(p);
	}
}

export function repoRoot(cwd: string): string {
	const r = git(cwd, ["rev-parse", "--show-toplevel"]);
	return canonical(r.ok && r.out ? r.out : cwd);
}

/** Record the repo's current state without changing anything (git stash create writes only an object). */
export function startBaseline(cwd: string): Baseline {
	const root = repoRoot(cwd);
	let ref: string | null = null;
	if (git(root, ["rev-parse", "--is-inside-work-tree"]).ok) {
		const stash = git(root, ["stash", "create"]);
		ref = stash.ok && stash.out ? stash.out : git(root, ["rev-parse", "HEAD"]).out || null;
	}
	return { root, ref, byFile: new Map() };
}

const fileOf = (key: string) => key.split("::")[0];

/** Outcomes at the start for the given test files, running them once in a temporary worktree. */
export async function baselineOutcomes(b: Baseline, kind: RepoKind, python: string, files: string[], timeoutS: number, signal?: AbortSignal): Promise<Map<string, TestCase["outcome"]>> {
	const out = new Map<string, TestCase["outcome"]>();
	if (!b.ref) return out;
	const missing = files.filter((f) => !b.byFile.has(f));
	const runnable = missing.filter((f) => git(b.root, ["cat-file", "-e", `${b.ref}:${f}`]).ok);
	for (const f of missing) if (!runnable.includes(f)) b.byFile.set(f, new Map()); // didn't exist: every failure in it is new
	if (runnable.length) {
		const wt = mkdtempSync(join(tmpdir(), "luthicode-baseline-"));
		rmSync(wt, { recursive: true, force: true });
		try {
			if (git(b.root, ["worktree", "add", "--detach", "--quiet", wt, b.ref]).ok) {
				// A private compiled-extension cache, so the two checkouts never load each other's builds.
				const r = await runPytest(kind, python, wt, runnable, timeoutS, signal, { TORCH_EXTENSIONS_DIR: `${wt}.build-cache` });
				for (const f of runnable) b.byFile.set(f, new Map());
				for (const c of r.cases) b.byFile.get(fileOf(c.key))?.set(c.key, c.outcome);
			}
		} finally {
			git(b.root, ["worktree", "remove", "--force", wt]);
			git(b.root, ["worktree", "prune"]);
			rmSync(wt, { recursive: true, force: true });
			rmSync(`${wt}.build-cache`, { recursive: true, force: true });
		}
	}
	for (const f of files) for (const [k, v] of b.byFile.get(f) ?? []) out.set(k, v);
	return out;
}

// ---------------------------------------------------------------- report

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export function report(r: RunResult, before: Map<string, TestCase["outcome"]> | null): { text: string; details: Record<string, unknown> } {
	const count = (o: TestCase["outcome"]) => r.cases.filter((c) => c.outcome === o).length;
	const bad = r.cases.filter((c) => c.outcome === "failed" || c.outcome === "error");
	const wasBad = (c: TestCase) => before?.get(c.key) === "failed" || before?.get(c.key) === "error";
	const fresh = bad.filter((c) => !wasBad(c));
	const old = bad.filter(wasBad);
	const parts = [`${count("passed")} passed, ${count("failed")} failed, ${count("error")} errors, ${count("skipped")} skipped (${r.seconds}s)`];
	if (r.timedOut) parts.push("Stopped at the time limit; results are partial.");
	if (!r.cases.length) parts.push("No test results. pytest output:\n" + clip(r.output.trim().split("\n").slice(-30).join("\n"), 3000));
	const lines: string[] = [];
	if (fresh.length) {
		lines.push(before ? `\nNew failures (${fresh.length}):` : `\nFailures (${fresh.length}):`);
		for (const c of fresh) lines.push(`- ${c.key}\n${clip(c.message, MAX_FAILURE_CHARS).replace(/^/gm, "    ")}`);
	}
	if (old.length) {
		lines.push(`\nAlready failing before you started (${old.length}), not caused by your changes:`);
		for (const c of old) lines.push(`- ${c.key}`);
	}
	let text = parts.join("\n");
	for (const l of lines) {
		if (text.length + l.length > MAX_REPORT_CHARS) {
			text += `\n…(${lines.length - lines.indexOf(l)} more lines cut; rerun on fewer targets for detail)`;
			break;
		}
		text += "\n" + l;
	}
	return {
		text,
		details: { passed: count("passed"), failed: count("failed"), errors: count("error"), skipped: count("skipped"), new_failures: fresh.map((c) => c.key), old_failures: old.map((c) => c.key), seconds: r.seconds, timed_out: r.timedOut },
	};
}

// ---------------------------------------------------------------- extension

const PARAMETERS = {
	type: "object",
	properties: {
		paths: { type: "array", items: { type: "string" }, minItems: 1, description: "Test files, folders or test ids (file.py::test_name)." },
		timeout_s: { type: "number", description: `Time limit in seconds (default ${DEFAULT_TIMEOUT_S}).` },
	},
	required: ["paths"],
	additionalProperties: false,
};

export default function (pi: ExtensionAPI) {
	let baseline: Baseline | null = null;

	pi.on("session_start", async (_event, ctx) => {
		baseline = startBaseline(ctx.cwd);
	});

	pi.registerTool({
		name: "run_tests",
		label: "run tests",
		description: "Run the repo's tests on CPU and report only the failures, each marked new or already failing before you started.",
		parameters: PARAMETERS as never,
		annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
		async execute(_id: string, params: { paths: string[]; timeout_s?: number }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: { cwd: string }) {
			const cwd = canonical(ctx.cwd);
			const root = repoRoot(cwd);
			const targets = normalizeTargets(root, cwd, params.paths);
			const timeoutS = Math.min(Math.max(1, params.timeout_s ?? DEFAULT_TIMEOUT_S), MAX_TIMEOUT_S);
			const kind = detectRepo(root);
			const python = pythonFor(root);
			const r = await runPytest(kind, python, root, targets, timeoutS, signal);
			const failing = r.cases.filter((c) => c.outcome === "failed" || c.outcome === "error");
			let before: Map<string, TestCase["outcome"]> | null = null;
			if (failing.length && !r.timedOut && !signal?.aborted) {
				baseline ??= startBaseline(cwd);
				if (baseline.ref && baseline.root === root) before = await baselineOutcomes(baseline, kind, python, [...new Set(failing.map((c) => fileOf(c.key)))], timeoutS, signal);
			}
			const { text, details } = report(r, before);
			return { content: [{ type: "text" as const, text }], details };
		},
	} as never);
}
