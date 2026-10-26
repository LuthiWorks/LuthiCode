// Check candidate tasks and keep the ones that work as tests.
//
//   node eval/build/validate.mjs candidates.json [--repo sanctuary] [--limit 20] [--log validation.json]
//
// For each candidate, in a fresh worktree at the commit's parent:
//   A. add the commit's tests                 -> run them
//   B. add the commit's source change too     -> run them again, twice
// fail_to_pass: tests that pass in both B runs and did not pass in A.
// pass_to_pass: tests that pass in A and both B runs.
// A candidate becomes a task only if fail_to_pass is non-empty.
// Valid tasks are written to eval/tasks/<repo>/<id>.json without an
// instruction; those are written by hand afterwards.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_DIR, checkoutFiles, createWorktree, loadConfig, removeWorktree, runTests } from "../lib.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const candidates = JSON.parse(readFileSync(args[0], "utf-8"));
const repoFilter = opt("--repo");
const limit = Number(opt("--limit") ?? Infinity);
const logPath = opt("--log") ?? join(EVAL_DIR, "build", "validation.local.json");
const cfg = loadConfig();

// What each repo's CI does before and around its tests, so tasks run the same way.
const REPO_DEFAULTS = {
	sanctuary: {
		pytest_args: ["--timeout=120", "-m", "not benchmark and not integration and not property"],
		setup_dirs: ["data/Protocols", "data/identity"],
	},
};

const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf-8")) : {};
const save = () => writeFileSync(logPath, JSON.stringify(log, null, 1) + "\n");

let done = 0;
for (const c of candidates) {
	if (repoFilter && c.repo !== repoFilter) continue;
	if (done >= limit) break;
	const id = `${c.repo}-${c.commit.slice(0, 8)}`;
	if (log[id]) continue; // already checked
	done++;
	const task = { id, ...c, ...(REPO_DEFAULTS[c.repo] ?? {}) };
	const dir = join(cfg.work, "validate", id);
	const t0 = Date.now();
	process.stderr.write(`${id}  ${c.subject.slice(0, 70)}\n`);
	try {
		createWorktree(task, cfg, dir);
		checkoutFiles(dir, c.commit, c.test_files);
		const a = runTests(task, cfg, dir, c.run_files);
		checkoutFiles(dir, c.commit, c.gold_files);
		const b1 = runTests(task, cfg, dir, c.run_files);
		const b2 = runTests(task, cfg, dir, c.run_files);
		const passedB = (t) => b1.outcomes[t] === "passed" && b2.outcomes[t] === "passed";
		const ids = Object.keys(b1.outcomes);
		const f2p = ids.filter((t) => passedB(t) && a.outcomes[t] !== "passed");
		const p2p = ids.filter((t) => passedB(t) && a.outcomes[t] === "passed");
		const flaky = ids.filter((t) => b1.outcomes[t] !== b2.outcomes[t]);
		const entry = {
			valid: f2p.length > 0,
			reason: f2p.length ? "ok" : b1.timedOut || a.timedOut ? "timed out" : ids.length === 0 ? "no tests ran" : "no test changes from failing to passing",
			fail_to_pass: f2p,
			pass_to_pass: p2p,
			failing_after: ids.filter((t) => !passedB(t)),
			flaky,
			seconds: Math.round((Date.now() - t0) / 1000),
			tail: f2p.length ? undefined : b1.tail.slice(-1500),
		};
		log[id] = entry;
		if (entry.valid) {
			const outDir = join(EVAL_DIR, "tasks", c.repo);
			mkdirSync(outDir, { recursive: true });
			const spec = {
				id,
				repo: c.repo,
				seat: "implementation",
				instruction: "",
				commit: c.commit,
				base: c.base,
				test_files: c.test_files,
				run_files: c.run_files,
				gold_files: c.gold_files,
				fail_to_pass: f2p,
				pass_to_pass: p2p,
				...(REPO_DEFAULTS[c.repo] ?? {}),
				source: { subject: c.subject, date: c.date, src_lines: c.src_lines },
			};
			const file = join(outDir, `${id}.json`);
			if (existsSync(file)) spec.instruction = JSON.parse(readFileSync(file, "utf-8")).instruction ?? "";
			writeFileSync(file, JSON.stringify(spec, null, 1) + "\n");
		}
		process.stderr.write(`   ${entry.valid ? "VALID" : "reject"}  f2p=${f2p.length} p2p=${p2p.length} flaky=${flaky.length}  ${entry.seconds}s  ${entry.reason}\n`);
	} catch (e) {
		log[id] = { valid: false, reason: `error: ${String(e.message ?? e).slice(0, 500)}`, seconds: Math.round((Date.now() - t0) / 1000) };
		process.stderr.write(`   error: ${String(e.message ?? e).slice(0, 200)}\n`);
	} finally {
		removeWorktree(task, cfg, dir);
		save();
	}
}
