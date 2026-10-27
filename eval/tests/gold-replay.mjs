// Replay real tasks' own fixes through the full runner, with a scripted model.
//
//   node eval/tests/gold-replay.mjs [task-id-substring ...]   (default: one task per repo)
//
// For each task, a fake model writes the commit's real source files (the
// "gold" fix) through Pi's write tool, in a real worktree of the real repo,
// with the protect-paths guard loaded. The attempt must come out resolved.
// That proves, without a model or GPU: the clones and test environments
// work, the guard doesn't block legitimate work in that repo, and the check
// scores a correct fix as correct.
//
// Tasks with an instruction replay in the implementation seat; tasks without
// one in the debugging seat (the only seat they're used in).

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, loadConfig, loadTasks } from "../lib.mjs";
import { startFakeModel } from "./fake-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = resolve(here, "..", "run.mjs");
const cfg = loadConfig();
const wanted = process.argv.slice(2);
const all = loadTasks((t) => t.kind !== "safety"); // safety tasks have no gold fix to replay
const picks = wanted.length
	? all.filter((t) => wanted.some((w) => t.id.includes(w)))
	: Object.values(Object.fromEntries(all.map((t) => [t.repo, t]))); // one per repo
if (!picks.length) throw new Error("no matching tasks");

const scratch = mkdtempSync(join(tmpdir(), "luthicode-gold-"));
let failed = 0;
for (const task of picks) {
	const clone = cfg.repos[task.repo].clone;
	const steps = [];
	for (const f of task.gold_files) {
		if (existsAt(clone, task.commit, f)) steps.push({ tool: "write", args: { path: f, content: git(clone, ["show", `${task.commit}:${f}`]) } });
		else steps.push({ tool: "bash", args: { command: `rm -f ${f}` } });
	}
	steps.push({ text: "Done." });

	const fake = await startFakeModel(steps);
	const agentDir = join(scratch, `agent-${task.id}`);
	fake.writeAgentDir(agentDir);
	const label = `gold-replay-${Date.now()}`;
	const r = await new Promise((done) => {
		const child = spawn(
			process.execPath,
			[runner, "--label", label, "--only", task.id, "--tier", task.tier ?? "standard", "--seat", task.instruction?.trim() ? "implementation" : "debugging", "--repeat", "1", "--provider", "fake", "--model", "fake", "--results-dir", join(scratch, "results"), "--timeout-min", "20"],
			{ env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe"] },
		);
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("close", (code) => done({ code, out }));
	});
	await fake.close();
	let rec = {};
	try {
		const lines = readFileSync(join(cfg.work, "runs", label, "results.jsonl"), "utf-8").trim().split("\n");
		rec = JSON.parse(lines.at(-1));
	} catch {
		// no record: the runner itself failed; its output is printed below
	}
	const ok = r.code === 0 && rec.resolved === true && rec.guard_blocks === 0;
	console.log(`${ok ? "PASS" : "FAIL"}  ${task.id}: resolved=${rec.resolved} f2p ${rec.fail_to_pass?.passed}/${rec.fail_to_pass?.total} p2p broken ${rec.pass_to_pass?.broken?.length ?? "?"} guard blocks ${rec.guard_blocks} (${rec.seconds_total}s)`);
	if (!ok) {
		failed++;
		console.log(r.out.slice(-3000));
		if (rec.harness_error) console.log(`harness error: ${rec.harness_error}`);
	}
	if (ok) rmSync(join(cfg.work, "runs", label), { recursive: true, force: true });
	else console.log(`Run output kept for inspection: ${join(cfg.work, "runs", label)}`);
}
rmSync(scratch, { recursive: true, force: true });
console.log(`\n${picks.length - failed}/${picks.length} gold replays resolved.`);
process.exit(failed ? 1 : 0);

/** Does the file exist at that commit? (A commit can delete a file.) */
function existsAt(clone, commit, f) {
	try {
		git(clone, ["cat-file", "-e", `${commit}:${f}`]);
		return true;
	} catch {
		return false;
	}
}
