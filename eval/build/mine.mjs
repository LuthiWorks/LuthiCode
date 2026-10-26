// Find past commits that could become eval tasks: a small change to source
// code, made together with the tests that check it.
//
//   node eval/build/mine.mjs [--tier large] > candidates.json
//
// Output: a JSON list of candidates, newest first. validate.mjs turns them
// into tasks after checking that their tests fail before the change and pass
// after it.
//
// Size is counted in source lines changed (added + deleted) and source files.
// The standard tier is each repo's own limit; the large tier is everything
// above it up to LARGE, kept as a separate tier so it is scored on its own
// line. Commits above LARGE are whole features, too big to state as one task.

import { git, loadConfig } from "../lib.mjs";

const REPOS = {
	luthimodel: {
		testDir: /^tests\//,
		src: /^luthi\/.*\.py$/,
		standard: { lines: 150, files: 3 },
	},
	sanctuary: {
		testDir: /^sanctuary\/(tests|mind\/tests)\//,
		src: /^sanctuary\/(?!tests\/|mind\/tests\/|data\/).*\.py$/,
		// Sanctuary's commits run larger for the same amount of logic (async plumbing, wiring).
		standard: { lines: 300, files: 4 },
	},
};
const LARGE = { lines: 600, files: 8 };
const TEST_FILE = /(^|\/)test_[^/]*\.py$/;
const PROTECTED = /(^|\/)(data|\.memories)\/|constitutional|charter|rights|sovereignty/i;
const DOCS = /\.(md|txt|rst)$/i;

const tierIdx = process.argv.indexOf("--tier");
const tier = tierIdx > 0 ? process.argv[tierIdx + 1] : "standard";
if (!["standard", "large"].includes(tier)) throw new Error("--tier must be standard or large");

const cfg = loadConfig();
const out = [];
for (const [repo, rules] of Object.entries(REPOS)) {
	if (!cfg.repos[repo]) continue;
	// --no-renames: a moved file is listed as a deletion plus an addition. With
	// rename detection, numstat writes "{old => new}/file", which is not a path.
	const log = git(cfg.repos[repo].clone, ["log", "origin/main", "--no-merges", "--no-renames", "--format=@@%H%x09%P%x09%ad%x09%s", "--date=short", "--numstat"]);
	for (const block of log.split("@@").slice(1)) {
		const [head, ...rows] = block.trim().split("\n");
		const [sha, parents, date, subject] = head.split("\t");
		if (!parents || parents.includes(" ")) continue;
		const files = rows.filter((r) => r.trim()).map((r) => {
			const [a, d, f] = r.split("\t");
			return { f, lines: a === "-" ? 999 : Number(a) + Number(d) };
		});
		const testSide = files.filter((x) => rules.testDir.test(x.f));
		const runFiles = testSide.filter((x) => TEST_FILE.test(x.f)).map((x) => x.f);
		const gold = files.filter((x) => !rules.testDir.test(x.f) && !DOCS.test(x.f));
		const src = gold.filter((x) => rules.src.test(x.f));
		if (!src.length || !runFiles.length) continue;
		if (files.some((x) => PROTECTED.test(x.f))) continue; // never build tasks that touch protected files
		const srcLines = src.reduce((n, x) => n + x.lines, 0);
		if (srcLines < 3) continue;
		const fits = (lim) => srcLines <= lim.lines && src.length <= lim.files;
		if (tier === "standard" ? !fits(rules.standard) : fits(rules.standard) || !fits(LARGE)) continue;
		out.push({
			repo, commit: sha, base: parents, date, subject,
			...(tier === "large" ? { tier } : {}),
			test_files: testSide.map((x) => x.f),
			run_files: runFiles,
			gold_files: gold.map((x) => x.f),
			src_lines: srcLines,
		});
	}
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
console.error(Object.keys(REPOS).map((r) => `${r}: ${out.filter((c) => c.repo === r).length}`).join(", "));
