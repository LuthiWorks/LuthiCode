// Run one CI step and, if it fails, report the end of its output as a GitHub
// annotation, so failures can be read from the run's summary (and through the
// REST API) without downloading logs.
//
//   node .github/ci-step.mjs "<title>" <command> [args...]

import { spawn } from "node:child_process";

const [title, cmd, ...args] = process.argv.slice(2);
const isWin = process.platform === "win32";
const chunks = [];
// Steps are Node scripts: run them with this Node directly, never through a shell.
const exe = cmd === "node" ? process.execPath : cmd;
const child = spawn(exe, args, { shell: isWin && exe !== process.execPath, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (d) => {
	process.stdout.write(d);
	chunks.push(d);
});
child.stderr.on("data", (d) => {
	process.stderr.write(d);
	chunks.push(d);
});
child.on("close", (code) => {
	if (code !== 0) {
		const tail = Buffer.concat(chunks).toString("utf-8").split(/\r?\n/).filter((l) => l.trim()).slice(-60).join("\n");
		// Workflow commands need %, CR and LF escaped.
		const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
		console.log(`::error title=${esc(`${process.platform}: ${title}`).replace(/[:,]/g, " ")}::${esc(tail.slice(-20000))}`);
	}
	process.exit(code ?? 1);
});
