// Run the local agent on eval tasks and score the results.
//
//   node eval/run.mjs --label baseline [options]
//
// Options:
//   --label <name>        name for this run (required); results go to eval/results/<date>_<label>.md
//   --only <text>         only tasks whose id contains this text (repeatable)
//   --repo <name>         only tasks from this repo
//   --seat <seat>         implementation (default) or debugging
//   --tier <tier>         standard (default) or large; each tier is scored on its own
//   --repeat <n>          attempts per task (default 3)
//   --provider <name>     Pi provider (default llama-cpp)
//   --model <id>          Pi model id (default qwen3.6-35b-a3b)
//   --thinking <level>    Pi thinking level (default off)
//   --extension <name>    LuthiCode extension to load, from extensions/<name>.ts (repeatable;
//                         protect-paths is always loaded)
//   --timeout-min <n>     minutes per attempt before it is stopped (default 30; 60 for the large tier)
//   --keep                keep worktrees afterwards, for inspection
//
// Each attempt runs in a throwaway git worktree of the task's repo at the
// task's starting commit. Pi runs unattended with only the named extensions
// (so a run measures exactly what it says), never pushes, and is stopped at
// the timeout. Then the task's tests are put back in place and run.
//
// Output: one line per attempt in <work>/runs/<label>/results.jsonl (with
// transcripts and diffs beside it), and a summary in eval/results/.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EVAL_DIR, checkoutFiles, checkTask, createWorktree, loadConfig, loadTasks, markBaseline, removeWorktree, runTests, taskEnv, worktreeDiff } from "./lib.mjs";

const REPO_ROOT = resolve(EVAL_DIR, "..");
const isWin = process.platform === "win32";

// ---------------------------------------------------------------- options

export function parseArgs(argv) {
	const o = { only: [], extension: [], repeat: 3, seat: "implementation", tier: "standard", provider: "llama-cpp", model: "qwen3.6-35b-a3b", thinking: "off", keep: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === "--label") o.label = next();
		else if (a === "--only") o.only.push(next());
		else if (a === "--repo") o.repo = next();
		else if (a === "--seat") o.seat = next();
		else if (a === "--tier") o.tier = next();
		else if (a === "--repeat") o.repeat = Number(next());
		else if (a === "--provider") o.provider = next();
		else if (a === "--model") o.model = next();
		else if (a === "--thinking") o.thinking = next();
		else if (a === "--extension") o.extension.push(next());
		else if (a === "--timeout-min") o.timeoutMin = Number(next());
		else if (a === "--keep") o.keep = true;
		else if (a === "--config") o.config = next();
		else if (a === "--pi") o.pi = next();
		else if (a === "--tasks-dir") o.tasksDir = next();
		else if (a === "--results-dir") o.resultsDir = next();
		else throw new Error(`unknown option ${a}`);
	}
	if (!o.label || !/^[\w.-]+$/.test(o.label)) throw new Error("--label <name> is required (letters, digits, . _ -)");
	if (!["implementation", "debugging"].includes(o.seat)) throw new Error("--seat must be implementation or debugging");
	if (!["standard", "large"].includes(o.tier)) throw new Error("--tier must be standard or large");
	o.timeoutMin ??= o.tier === "large" ? 60 : 30;
	return o;
}

// ---------------------------------------------------------------- prompts

const IMPLEMENTATION_SUFFIX =
	"\n\nWork in this repository. When the change is complete and its tests pass, stop and summarize what you changed. " +
	"Don't commit, and don't ask questions: no one is available to answer during this run.";

export function promptFor(task, seat, failingOutput) {
	if (seat === "debugging") {
		return (
			"These tests fail:\n\n```\n" + failingOutput.trim() + "\n```\n\n" +
			"Find the cause in the code and fix it so the tests pass. Don't change the tests." + IMPLEMENTATION_SUFFIX
		);
	}
	if (!task.instruction?.trim()) throw new Error(`task ${task.id} has no instruction yet`);
	return task.instruction.trim() + IMPLEMENTATION_SUFFIX;
}

// ---------------------------------------------------------------- Pi

function piCommand(opts) {
	return opts.pi ?? process.env.PI_BIN ?? "pi";
}

function extensionArgs(opts) {
	const names = ["protect-paths", ...opts.extension.filter((e) => e !== "protect-paths")];
	const args = ["--no-extensions"];
	for (const n of names) {
		const file = join(REPO_ROOT, "extensions", `${n}.ts`);
		if (!existsSync(file)) throw new Error(`no extension at ${file}`);
		args.push("-e", file);
	}
	return { args, names };
}

/**
 * Run Pi once, unattended. Resolves with the exit code, or "timeout".
 * The prompt goes in on stdin, not as an argument: on Windows Pi runs through
 * a .cmd shim and the shell, where a multi-line argument with quotes, & or |
 * would be mangled. Stdin arrives byte for byte.
 */
function runPi(opts, prompt, cwd, env, transcriptPath, stderrPath) {
	const { args: extArgs } = extensionArgs(opts);
	const args = [
		"--mode", "json",
		"--no-session",
		"--provider", opts.provider,
		"--model", opts.model,
		"--thinking", opts.thinking,
		...extArgs,
	];
	const q = (a) => (isWin && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
	return new Promise((resolveRun) => {
		const child = spawn(isWin ? q(piCommand(opts)) : piCommand(opts), isWin ? args.map(q) : args, {
			cwd,
			env,
			shell: isWin,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		child.stdin.on("error", () => {}); // Pi may exit before reading all of it
		child.stdin.end(prompt);
		const out = [];
		const err = [];
		child.stdout.on("data", (d) => out.push(d));
		child.stderr.on("data", (d) => err.push(d));
		const timer = setTimeout(() => {
			if (isWin) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
			else child.kill("SIGKILL");
			finish("timeout");
		}, opts.timeoutMin * 60_000);
		let done = false;
		function finish(code) {
			if (done) return;
			done = true;
			clearTimeout(timer);
			writeFileSync(transcriptPath, Buffer.concat(out));
			writeFileSync(stderrPath, Buffer.concat(err));
			resolveRun(code);
		}
		child.on("close", (code) => finish(code));
		child.on("error", (e) => {
			err.push(Buffer.from(String(e)));
			finish("error");
		});
	});
}

/** Counts from Pi's JSON event stream. */
export function summarizeTranscript(jsonl) {
	const s = { turns: 0, tool_calls: 0, tool_errors: 0, guard_blocks: 0, tools: {}, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, stop_reason: null, error: null };
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		let e;
		try {
			e = JSON.parse(line.replace(/\r$/, ""));
		} catch {
			continue; // a partial last line from a stopped run
		}
		if (e.type === "turn_start") s.turns++;
		if (e.type === "tool_execution_start") {
			s.tool_calls++;
			s.tools[e.toolName] = (s.tools[e.toolName] ?? 0) + 1;
		}
		if (e.type === "tool_execution_end" && e.isError) {
			s.tool_errors++;
			if (/protect-paths blocked/.test(JSON.stringify(e.result ?? ""))) s.guard_blocks++;
		}
		if (e.type === "message_end" && e.message?.role === "assistant") {
			const u = e.message.usage ?? {};
			s.input_tokens += u.input ?? 0;
			s.output_tokens += u.output ?? 0;
			s.cache_read_tokens += u.cacheRead ?? 0;
			s.stop_reason = e.message.stopReason ?? s.stop_reason;
			if (e.message.errorMessage) s.error = e.message.errorMessage;
		}
	}
	return s;
}

// ---------------------------------------------------------------- one attempt

async function attempt(task, k, opts, cfg, outDir) {
	const name = `${task.id}.${opts.seat}.r${k}`;
	const dir = join(cfg.work, "wt", opts.label, name);
	const t0 = Date.now();
	const record = { task: task.id, repo: task.repo, seat: opts.seat, tier: tierOf(task), attempt: k, label: opts.label, model: opts.model, thinking: opts.thinking, extensions: extensionArgs(opts).names, started: new Date().toISOString() };
	try {
		createWorktree(task, cfg, dir);
		let failingOutput = "";
		if (opts.seat === "debugging") {
			// The tests are in place from the start; the agent sees only their failures.
			checkoutFiles(dir, task.commit, task.test_files);
			failingOutput = runTests(task, cfg, dir, task.run_files).tail;
		}
		markBaseline(dir);
		const prompt = promptFor(task, opts.seat, failingOutput);
		const env = taskEnv(task, cfg, dir);
		const exit = await runPi(opts, prompt, dir, env, join(outDir, `${name}.jsonl`), join(outDir, `${name}.stderr.txt`));
		record.pi_exit = exit;
		record.seconds_agent = Math.round((Date.now() - t0) / 1000);
		Object.assign(record, summarizeTranscript(readFileSync(join(outDir, `${name}.jsonl`), "utf-8")));
		const diff = worktreeDiff(dir);
		writeFileSync(join(outDir, `${name}.diff`), diff);
		record.diff_lines = diff ? diff.split("\n").filter((l) => /^[+-](?![+-])/.test(l)).length : 0;
		record.touched_tests = task.test_files.filter((f) => diff.includes(`a/${f}`) || diff.includes(`b/${f}`));
		const check = checkTask(task, cfg, dir);
		record.resolved = check.resolved;
		record.fail_to_pass = check.fail_to_pass;
		record.pass_to_pass = check.pass_to_pass;
		record.check_timed_out = check.timedOut;
		if (!check.resolved) writeFileSync(join(outDir, `${name}.check.txt`), check.tail);
	} catch (e) {
		record.resolved = false;
		record.harness_error = String(e.message ?? e).slice(0, 2000);
	} finally {
		record.seconds_total = Math.round((Date.now() - t0) / 1000);
		if (!opts.keep) removeWorktree(task, cfg, dir);
	}
	return record;
}

// ---------------------------------------------------------------- summary

export function summarize(records, opts) {
	const byTask = new Map();
	for (const r of records) {
		if (!byTask.has(r.task)) byTask.set(r.task, []);
		byTask.get(r.task).push(r);
	}
	const lines = [];
	const resolvedAttempts = records.filter((r) => r.resolved).length;
	const perTaskRates = [...byTask.values()].map((rs) => rs.filter((r) => r.resolved).length / rs.length);
	const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
	const pct = (x) => `${Math.round(x * 100)}%`;
	// Spread across repeats: the resolve rate of repeat 1, repeat 2, ... over all tasks.
	const byRepeat = [];
	for (let k = 1; k <= opts.repeat; k++) {
		const rs = records.filter((r) => r.attempt === k);
		if (rs.length) byRepeat.push(rs.filter((r) => r.resolved).length / rs.length);
	}
	lines.push(`# Eval: ${opts.label}`, "");
	lines.push(`- Date: ${new Date().toISOString().slice(0, 10)}`);
	lines.push(`- Model: ${opts.provider}/${opts.model}, thinking ${opts.thinking}`);
	lines.push(`- Extensions: ${extensionArgs(opts).names.join(", ")}`);
	lines.push(`- Seat: ${opts.seat}, ${opts.tier} tier; ${byTask.size} tasks x ${opts.repeat} attempts, ${opts.timeoutMin} min limit each`);
	lines.push("");
	lines.push(`**Resolved: ${resolvedAttempts}/${records.length} attempts (${pct(resolvedAttempts / Math.max(1, records.length))}).** Mean per-task rate ${pct(mean(perTaskRates))}. By repeat: ${byRepeat.map(pct).join(", ")}.`);
	lines.push("");
	const sum = (f) => records.reduce((n, r) => n + (r[f] ?? 0), 0);
	lines.push(`Totals: ${sum("tool_calls")} tool calls, ${sum("tool_errors")} tool errors, ${sum("guard_blocks")} guard blocks, ${sum("output_tokens")} output tokens, ${Math.round(sum("seconds_total") / 60)} minutes.`);
	const timeouts = records.filter((r) => r.pi_exit === "timeout").length;
	const harness = records.filter((r) => r.harness_error).length;
	if (timeouts || harness) lines.push(`Stopped at timeout: ${timeouts}. Harness errors: ${harness}.`);
	lines.push("", "| Task | Resolved | Tool calls (mean) | Guard blocks | Minutes (mean) | Notes |", "|---|---|---|---|---|---|");
	for (const [id, rs] of byTask) {
		const notes = [];
		if (rs.some((r) => r.pi_exit === "timeout")) notes.push("timeout");
		if (rs.some((r) => r.harness_error)) notes.push("harness error");
		if (rs.some((r) => r.touched_tests?.length)) notes.push("edited tests");
		if (rs.some((r) => !r.resolved && r.pass_to_pass?.broken?.length)) notes.push("broke other tests");
		if (rs.some((r) => r.diff_lines === 0)) notes.push("no changes");
		lines.push(`| ${id} | ${rs.filter((r) => r.resolved).length}/${rs.length} | ${Math.round(mean(rs.map((r) => r.tool_calls ?? 0)))} | ${rs.reduce((n, r) => n + (r.guard_blocks ?? 0), 0)} | ${Math.round(mean(rs.map((r) => r.seconds_total ?? 0)) / 60)} | ${notes.join(", ")} |`);
	}
	return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- main

/** Tasks without a tier field are standard. */
export const tierOf = (task) => task.tier ?? "standard";

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const cfg = loadConfig(opts.config);
	const tasks = loadTasks(
		(t) =>
			tierOf(t) === opts.tier &&
			(!opts.repo || t.repo === opts.repo) &&
			(opts.only.length === 0 || opts.only.some((o) => t.id.includes(o))) &&
			(opts.seat === "debugging" || t.instruction?.trim()),
		opts.tasksDir,
	);
	if (!tasks.length) throw new Error("no tasks match");
	const outDir = join(cfg.work, "runs", opts.label);
	mkdirSync(outDir, { recursive: true });
	const resultsPath = join(outDir, "results.jsonl");
	const records = existsSync(resultsPath) ? readFileSync(resultsPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
	const done = new Set(records.map((r) => `${r.task}.${r.seat}.r${r.attempt}`));
	console.error(`${tasks.length} tasks x ${opts.repeat} attempts, label ${opts.label}. Output: ${outDir}`);
	for (let k = 1; k <= opts.repeat; k++) {
		for (const task of tasks) {
			const key = `${task.id}.${opts.seat}.r${k}`;
			if (done.has(key)) continue; // resume an interrupted run
			process.stderr.write(`${key} ... `);
			const r = await attempt(task, k, opts, cfg, outDir);
			records.push(r);
			appendFileSync(resultsPath, JSON.stringify(r) + "\n");
			process.stderr.write(`${r.resolved ? "RESOLVED" : "not resolved"} (${r.tool_calls ?? 0} tool calls, ${r.seconds_total}s${r.harness_error ? ", harness error: " + r.harness_error.slice(0, 120) : ""})\n`);
		}
	}
	const summary = summarize(records.filter((r) => r.seat === opts.seat && (r.tier ?? "standard") === opts.tier), opts);
	const resultsDir = opts.resultsDir ?? join(EVAL_DIR, "results");
	mkdirSync(resultsDir, { recursive: true });
	const tierSuffix = opts.tier === "standard" ? "" : `_${opts.tier}`;
	const summaryPath = join(resultsDir, `${new Date().toISOString().slice(0, 10)}_${opts.label}_${opts.seat}${tierSuffix}.md`);
	writeFileSync(summaryPath, summary);
	console.error(`\nSummary: ${summaryPath}`);
	process.stdout.write(summary);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(EVAL_DIR, "run.mjs")) {
	main().catch((e) => {
		console.error(String(e.message ?? e));
		process.exit(1);
	});
}
