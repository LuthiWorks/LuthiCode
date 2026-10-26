// One-time setup for the eval (re-run any time; it only does what's missing).
//
//   node eval/setup.mjs
//
// For each repo in eval/lib.mjs REPOS:
//   1. clone it into <work>/repos/<name> (its own clone, separate from yours), or fetch if present
//   2. build a CPU-only test environment at <work>/envs/<name> from the repo's uv.lock
//   3. check that torch and torchaudio load, fixing a torchaudio that doesn't match torch
//   4. run one quick test file, so a broken environment shows up now, not mid-eval
//
// Needs git, uv and Node. No GPU: on Windows, PyPI's torch builds are CPU-only,
// which is what the eval wants (the GPU belongs to the model server).

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPOS, git, loadConfig, pythonIn, run } from "./lib.mjs";

const cfg = loadConfig();
mkdirSync(cfg.work, { recursive: true });
let problems = 0;

for (const [name, info] of Object.entries(REPOS)) {
	const { clone, env } = cfg.repos[name];
	console.log(`\n== ${name}`);

	// 1. clone or fetch
	if (!existsSync(join(clone, ".git"))) {
		mkdirSync(dirname(clone), { recursive: true });
		console.log(`cloning ${info.url} -> ${clone}`);
		const r = run("git", ["clone", "--quiet", info.url, clone], { timeoutMs: 1_800_000 });
		if (r.code !== 0) {
			console.log(`  clone failed: ${r.stderr}`);
			problems++;
			continue;
		}
	} else {
		console.log(`fetching ${clone}`);
		git(clone, ["fetch", "--quiet", "origin"], { timeoutMs: 1_800_000, allowFail: true });
	}

	// 2. environment from the lockfile (CPU torch on Windows)
	if (!existsSync(pythonIn(env))) {
		console.log(`building environment ${env} (several GB; can take a while)`);
		const r = run("uv", ["sync", "--frozen", ...info.sync], {
			cwd: clone,
			env: { ...process.env, UV_PROJECT_ENVIRONMENT: env },
			timeoutMs: 7_200_000,
		});
		if (r.code !== 0) {
			console.log(`  uv sync failed:\n${(r.stderr || r.stdout).slice(-3000)}`);
			problems++;
			continue;
		}
	} else {
		console.log(`environment exists: ${env}`);
	}
	const py = pythonIn(env);

	// 3. torch and torchaudio must load and match. (LuthiModel's lockfile pairs
	//    torch 2.10.0 with torchaudio 2.11.0, which is built for torch 2.11.)
	const probe = (code) => run(py, ["-c", code], { env: { ...process.env, CUDA_VISIBLE_DEVICES: "" } });
	const versions = probe("import importlib.metadata as m; print(m.version('torch'), m.version('torchaudio'))");
	if (versions.code === 0) {
		const [torchV, audioV] = versions.stdout.trim().split(/\s+/);
		const mm = (v) => v.split("+")[0].split(".").slice(0, 2).join(".");
		if (mm(torchV) !== mm(audioV) || probe("import torchaudio.functional").code !== 0) {
			const want = torchV.split("+")[0];
			console.log(`torchaudio ${audioV} doesn't match torch ${torchV}; installing torchaudio ${want}`);
			const r = run("uv", ["pip", "install", "--python", py, `torchaudio==${want}`], { timeoutMs: 1_800_000 });
			if (r.code !== 0) console.log(`  failed: ${(r.stderr || r.stdout).slice(-1500)}`);
		}
	}
	const check = probe("import torch, torchaudio; print('torch', torch.__version__, 'gpu' if torch.cuda.is_available() else 'cpu')");
	if (check.code !== 0) {
		console.log(`  torch doesn't load:\n${check.stderr.slice(-1500)}`);
		problems++;
		continue;
	}
	console.log(`  ${check.stdout.trim()}`);

	// 4. one quick test file, from the clone itself
	const quick = name === "luthimodel" ? "tests/test_no_hardcoded_paths.py" : "sanctuary/tests/test_no_hardcoded_paths.py";
	if (!existsSync(join(clone, quick))) {
		console.log(`  (no ${quick} to try; skipped the quick test)`);
	} else {
		const r = run(py, ["-m", "pytest", quick, "-q", "-p", "no:cacheprovider"], {
			cwd: clone,
			env: { ...process.env, PYTHONPATH: clone, CUDA_VISIBLE_DEVICES: "", LUTHI_ALLOW_CPU: "1", LUTHI_BACKEND: "cpu", CI: "true" },
			timeoutMs: 600_000,
		});
		const last = (r.stdout + r.stderr).trim().split("\n").at(-1);
		console.log(`  ${quick}: ${last}`);
		if (r.code !== 0) problems++;
	}
}

console.log(problems ? `\n${problems} problem(s); see above.` : "\nSetup complete.");
process.exit(problems ? 1 : 0);
