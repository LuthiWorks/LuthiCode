// Write eval/build/validation.md from validation logs and the task folder.
//
//   node eval/build/report.mjs <validation-log.json> [...more logs] [--gold <gold-replay output file>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_DIR, loadTasks } from "../lib.mjs";

const args = process.argv.slice(2);
const goldIdx = args.indexOf("--gold");
const goldFile = goldIdx >= 0 ? args.splice(goldIdx, 2)[1] : null;
const log = Object.assign({}, ...args.map((p) => JSON.parse(readFileSync(p, "utf-8"))));
const tasks = new Map(loadTasks().map((t) => [t.id, t]));
const gold = new Map();
if (goldFile && existsSync(goldFile)) {
	for (const m of readFileSync(goldFile, "utf-8").matchAll(/^(PASS|FAIL)\s+(\S+):/gm)) gold.set(m[2], m[1]);
}

const repos = [...new Set(Object.keys(log).map((id) => id.split("-")[0]))].sort();
const out = ["# Task validation", "", `Generated ${new Date().toISOString().slice(0, 10)} by \`eval/build/report.mjs\`.`, ""];
out.push("A candidate becomes a task only if its tests fail on the parent commit and pass twice with the real change (`eval/build/validate.mjs`). Instructions are written by hand afterwards; a task without one is used only in the debugging seat, which needs no instruction.", "");
out.push("**Gold replay:** the commit's own fix written through Pi and the guard by a scripted model (`eval/tests/gold-replay.mjs`). It must resolve; anything else means the task or the environment is wrong.", "");

for (const repo of repos) {
	const ids = Object.keys(log).filter((id) => id.startsWith(`${repo}-`)).sort();
	const valid = ids.filter((id) => log[id].valid);
	const withInstr = valid.filter((id) => tasks.get(id)?.instruction?.trim());
	out.push(`## ${repo}`, "");
	out.push(`${ids.length} candidates checked: ${valid.length} valid, ${withInstr.length} with an instruction (implementation seat).`, "");
	out.push("| Task | Fail-to-pass | Pass-to-pass | Source lines | Instruction | Gold replay | Subject |", "|---|---|---|---|---|---|---|");
	for (const id of valid) {
		const t = tasks.get(id);
		out.push(`| ${id} | ${log[id].fail_to_pass.length} | ${log[id].pass_to_pass.length} | ${t?.source?.src_lines ?? "?"} | ${t?.instruction?.trim() ? "yes" : "no"} | ${gold.get(id) ?? "not run"} | ${(t?.source?.subject ?? "").replace(/\|/g, "/").slice(0, 70)} |`);
	}
	const rejected = ids.filter((id) => !log[id].valid);
	if (rejected.length) {
		out.push("", "Rejected:", "");
		for (const id of rejected) out.push(`- ${id}: ${log[id].reason}`);
	}
	out.push("");
}
writeFileSync(join(EVAL_DIR, "build", "validation.md"), out.join("\n"));
console.log(out.join("\n"));
