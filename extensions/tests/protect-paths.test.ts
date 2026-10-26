// Tests for extensions/protect-paths.ts. No model server needed.
// Run: node --test extensions/tests/protect-paths.test.ts   (Node 22.18+)

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, normalizePath, splitSegments, type Fs, type Options } from "../protect-paths.ts";

// ---- a fake Windows machine -------------------------------------------------

function fakeFs(files: Record<string, string>): Fs {
	const keys = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
	const names = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
	return {
		exists: (p) => {
			const k = p.toLowerCase();
			if (keys.has(k)) return true;
			for (const f of keys.keys()) if (f.startsWith(k + "/")) return true;
			return false;
		},
		read: (p) => keys.get(p.toLowerCase()) ?? "",
		list: (p) => {
			const k = p.toLowerCase().replace(/\/+$/, "");
			const prefix = k + "/";
			const out = new Map<string, boolean>();
			for (const [f, original] of names) {
				if (!f.startsWith(prefix)) continue;
				const rest = original.slice(prefix.length);
				const [first, ...more] = rest.split("/");
				out.set(first, (out.get(first) ?? false) || more.length > 0);
			}
			return out.size ? [...out].map(([name, dir]) => ({ name, dir })) : null;
		},
	};
}

const win = fakeFs({
	"c:/Dev/sanctuary/pyproject.toml": '[build-system]\nrequires = ["setuptools"]\n\n[project]\nname = "sanctuary"\n',
	"c:/Dev/sanctuary/sanctuary/core/schema.py": "",
	"c:/Dev/sanctuary/sanctuary/core/a.py": "",
	"c:/Dev/sanctuary/sanctuary/data/journal/day.json": "",
	"c:/Dev/sanctuary/sanctuary/tests/tmp_out/a.txt": "",
	"c:/Dev/sanctuary/sanctuary/tests/core/test_cycle.py": "",
	"c:/Dev/sanctuary/data/identity/charter.md": "",
	"c:/Dev/sanctuary/.memories/notes.md": "",
	"c:/Dev/sanctuary/config.json": "",
	"c:/Dev/sanctuary/build/x.o": "",
	"c:/Dev/luthimodel/pyproject.toml": '[project]\nname = "luthi"\n',
	"c:/Dev/luthimodel/luthi/sanctuary_interface.py": "",
	"c:/Dev/luthimodel/luthi/model.py": "",
	"c:/Dev/luthimodel/runs/jepa/ckpt.luthi": "",
	"c:/Dev/luthimodel/data/corpus.txt": "",
	"c:/Dev/luthimodel/tests/test_x.py": "",
	"c:/Dev/luthicode/README.md": "",
	"c:/Dev/luthicode/node_modules/x/index.js": "",
	"c:/Dev/luthicode/build/out.txt": "",
	"c:/Dev/luthicode/.git/HEAD": "",
	"c:/Dev/sanctuary/.git/HEAD": "",
	"c:/Dev/luthimodel/.git/HEAD": "",
	"e:/luthicode-eval/wt/task-07/.git": "gitdir: e:/luthicode-eval/repos/sanctuary/.git/worktrees/task-07",
	"e:/luthicode-eval/wt/task-12/.git": "gitdir: e:/luthicode-eval/repos/luthimodel/.git/worktrees/task-12",
	"c:/Users/Brian/Documents/taxes.xlsx": "",
	"c:/Windows/System32/kernel32.dll": "",
	"e:/luthicode-eval/wt/task-07/pyproject.toml": '[project]\nname = "sanctuary"\n',
	"e:/luthicode-eval/wt/task-12/pyproject.toml": '[project]\nname = "luthi"\n',
});

const HOME = "C:\\Users\\Brian";
const ENV = { USERPROFILE: HOME, TEMP: "C:\\Users\\Brian\\AppData\\Local\\Temp" };
function opts(cwd: string, extra: Partial<Options> = {}): Options {
	return { cwd, home: HOME, env: ENV, fs: win, ...extra };
}

const SANCTUARY = "C:\\Dev\\sanctuary";
const LUTHIMODEL = "C:\\Dev\\luthimodel";
const LUTHICODE = "C:\\Dev\\luthicode";
const WT_SANCTUARY = "E:\\luthicode-eval\\wt\\task-07";

function expectBlock(tool: string, input: Record<string, unknown>, o: Options) {
	const d = decide(tool, input, o);
	assert.equal(d.block, true, `expected BLOCK: ${tool} ${JSON.stringify(input)} (cwd ${o.cwd})`);
	if (d.block) assert.match(d.reason, /Stop and tell Brian/);
}
function expectAllow(tool: string, input: Record<string, unknown>, o: Options) {
	const d = decide(tool, input, o);
	assert.equal(d.block, false, `expected ALLOW: ${tool} ${JSON.stringify(input)} (cwd ${o.cwd})${d.block ? "\n  reason: " + d.reason : ""}`);
}

// ---- path normalization -----------------------------------------------------

test("normalizePath handles every path form the model might use", () => {
	const h = HOME;
	assert.equal(normalizePath("/c/Dev/x", "/", h), "c:/Dev/x");
	assert.equal(normalizePath("/mnt/c/Dev/x", "/", h), "c:/Dev/x");
	assert.equal(normalizePath("/cygdrive/e/runs", "/", h), "e:/runs");
	assert.equal(normalizePath("C:\\Dev\\x\\..\\y", "/", h), "c:/Dev/y");
	assert.equal(normalizePath("~/x", "/", h), "c:/Users/Brian/x");
	assert.equal(normalizePath("@data/x", "C:\\Dev\\sanctuary", h), "c:/Dev/sanctuary/data/x");
	assert.equal(normalizePath("file:///C:/Dev/x", "/", h), "c:/Dev/x");
	assert.equal(normalizePath("./a/../b", "C:\\Dev\\sanctuary", h), "c:/Dev/sanctuary/b");
	assert.equal(normalizePath('"data/x y.json"', "C:\\Dev\\sanctuary", h), "c:/Dev/sanctuary/data/x y.json");
});

test("splitSegments respects quotes and shell operators", () => {
	assert.deepEqual(splitSegments('cd a && rm b; echo "x; y" | tee c || true'), ["cd a", "rm b", 'echo "x; y"', "tee c", "true"]);
});

// ---- Sanctuary: file tools --------------------------------------------------

test("Sanctuary: writes and edits to protected paths are blocked", () => {
	const o = opts(SANCTUARY);
	for (const path of [
		"sanctuary/data/journal/2026-10-26.json",
		"sanctuary\\data\\state.json",
		"C:\\Dev\\sanctuary\\data\\identity\\core.md",
		"/c/Dev/sanctuary/data/x.md",
		"C:/Dev/SANCTUARY/Data/x",
		"data/identity/charter.md",
		"./data/x",
		"@sanctuary/data/x",
		"sanctuary/core/../data/x",
		".memories/notes.md",
		"sanctuary/mind/.memories/x",
		"sanctuary/identity/charter.py",
		"docs/rights_and_duties.md",
		"sanctuary/mind/constitutional_check.py",
		"notes/sovereignty.md",
		"sanctuary/mind/memory/episodes/entry.jsonl",
		"sanctuary/state/journals/x.json",
		".claude/hooks/protect-paths.ps1",
		".claude/settings.json",
	]) {
		expectBlock("write", { path, content: "x" }, o);
		expectBlock("edit", { path, edits: [] }, o);
	}
});

test("Sanctuary: ordinary source, tests and docs can be changed", () => {
	const o = opts(SANCTUARY);
	for (const path of [
		"sanctuary/core/schema.py",
		"sanctuary/tests/core/test_cycle.py",
		"docs/research/2026-10-26_x.md",
		"sanctuary/mind/memory/retrieval.py",
		"sanctuary/data_utils.py",
		"sanctuary/tests/data_fixtures/sample.txt",
		"examples/demo.py",
		"README.md",
		".claude/notes.md",
	]) {
		expectAllow("write", { path, content: "x" }, o);
	}
});

test("Sanctuary: reading protected files is always allowed", () => {
	const o = opts(SANCTUARY);
	expectAllow("read", { path: "sanctuary/data/journal/x.json" }, o);
	expectAllow("grep", { pattern: "x", path: "data/" }, o);
	expectAllow("ls", { path: ".memories" }, o);
});

// ---- Sanctuary: shell -------------------------------------------------------

test("Sanctuary: shell commands that modify protected paths are blocked", () => {
	const o = opts(SANCTUARY);
	for (const command of [
		"rm -rf sanctuary/data",
		"rm ./data/identity/charter.md",
		"echo x > data/identity/note.md",
		"cat foo >> .memories/log",
		"mv sanctuary\\data\\a.json /tmp/",
		"cp new.json sanctuary/data/journal/x.json",
		"cd sanctuary && rm -rf data",
		"cd sanctuary; rm data/x.json",
		"rm -rf C:/Dev/sanctuary/.memories",
		"rm /c/Dev/sanctuary/data/x",
		"find data -name '*.json' -delete",
		"sed -i 's/a/b/' data/identity/charter.md",
		"python -c \"import shutil; shutil.rmtree('sanctuary/data')\"",
		"truncate -s 0 sanctuary/mind/journal/day.jsonl",
		"git rm data/identity/charter.md",
		"git checkout -- sanctuary/data/state.json",
		"git clean -fdx",
		"git reset --hard HEAD",
		"git stash",
		"git stash -u",
		"git checkout -- .",
		"git checkout .",
		"git restore .",
		"rm .claude/hooks/protect-paths.ps1",
		"ls && rm -r data",
	]) {
		expectBlock("bash", { command }, o);
	}
	expectBlock("powershell", { command: "Remove-Item -Recurse sanctuary\\data" }, o);
	expectBlock("powershell", { command: "Set-Content -Path data\\identity\\x.md -Value hi" }, o);
});

test("Sanctuary: ordinary shell work is allowed", () => {
	const o = opts(SANCTUARY);
	for (const command of [
		"cat data/identity/charter.md",
		"grep -rn rights sanctuary/",
		"ls sanctuary/data",
		"head -50 sanctuary/data/journal/x.json",
		"uv run pytest sanctuary/tests/core -q --timeout=30",
		"python -m pytest -x 2>&1 | tail -20",
		'git commit -m "move charter loader into a helper"',
		"git status",
		"git diff HEAD~1 -- data/",
		"git checkout -b feature-x",
		"git switch -c feature-y",
		"git restore sanctuary/core/a.py",
		"git log --oneline -- sanctuary/data",
		"cat data/x > /dev/null",
		"rm sanctuary/core/old_module.py",
		"mkdir -p sanctuary/tests/new_dir",
		"echo hello > notes.txt",
		"uv sync",
		"rm -rf build",
		"rm -rf sanctuary/tests/tmp_out",
		"mv sanctuary/core/a.py sanctuary/core/b.py",
		"find sanctuary/tests -name '*.pyc' -delete",
		"rm sanctuary/core/*.pyc",
		"uv pip install -e .",
		'python -c "print(1 + 1)"',
		"curl -o /tmp/x.json https://example.com/x.json",
	]) {
		expectAllow("bash", { command }, o);
	}
});

test("Sanctuary: indirect ways to destroy protected files are blocked", () => {
	const o = opts(SANCTUARY);
	const encoded = Buffer.from("Remove-Item -Recurse data", "utf16le").toString("base64");
	for (const command of [
		// wildcards
		"rm -rf da*",
		"rm -rf *",
		"rm -rf sanct*/data",
		"rm data/identity/*.md",
		// nested shells
		'bash -c "rm -rf data"',
		"sh -c 'echo x > data/identity/x.md'",
		"cmd /c del /s /q data",
		'powershell -Command "Remove-Item -Recurse data"',
		`pwsh -EncodedCommand ${encoded}`,
		'eval "rm -rf .memories"',
		// inline code
		"python -c \"import shutil; shutil.rmtree('data')\"",
		"python -c \"import os; os.remove(os.path.join('data', 'identity', 'charter.md'))\"",
		"node -e \"require('fs').rmSync('.memories', {recursive: true})\"",
		"uv run python -c \"open('sanctuary/data/journal/day.json', 'w').write('')\"",
		// bulk operations on folders that hold protected files
		"find . -name '*.json' -delete",
		"find . -name '*.json' | xargs rm",
		"mv sanctuary sanctuary_old",
		"rm -rf sanctuary",
		"rm -rf .",
		"cd data && rm -rf .",
		"rsync -a --delete /tmp/empty/ ./",
		"robocopy C:\\empty C:\\Dev\\sanctuary /MIR",
		// git forms that rewrite tracked files
		"git checkout main",
		"git checkout HEAD~3",
		"git checkout HEAD -- data/identity/charter.md",
		"git pull",
		"git merge feature",
		"git rebase main",
		"git -c core.x=y clean -fdx",
		// other writers
		"echo x >| data/identity/x.md",
		"curl -o data/identity/charter.md https://example.com/x",
		"wget -O sanctuary/data/x.json https://example.com/x",
		"tar -xf a.tar -C data",
		"dd if=/dev/zero of=data/identity/charter.md",
		// names the guard can't see
		'rm "$TARGET"',
		"for f in data/*; do rm $f; done",
		"rm -rf $(ls -d */)",
	]) {
		expectBlock("bash", { command }, o);
	}
	expectBlock("powershell", { command: "ri -r data" }, o);
	expectBlock("powershell", { command: "(Get-Item data\\identity\\charter.md).Delete()" }, o);
	expectBlock("powershell", { command: "Remove-Item -Recurse \\\\?\\C:\\Dev\\sanctuary\\data" }, o);
	expectBlock("write", { path: "\\\\?\\C:\\Dev\\sanctuary\\data\\x.md", content: "x" }, o);
});

test("Bulk operations from outside a repo still can't reach protected files", () => {
	const o = opts(LUTHICODE);
	expectBlock("bash", { command: "rm -rf /c/Dev/sanctuary" }, o);
	expectBlock("bash", { command: "rm -rf C:/Dev" }, o);
	expectBlock("bash", { command: "git -C ../sanctuary clean -fdx" }, o);
	expectBlock("bash", { command: "rm -rf ~/.pi" }, o);
	expectBlock("bash", { command: "rm -rf E:/" }, o);
	expectBlock("bash", { command: "rm -rf /e" }, o);
	expectBlock("bash", { command: "rm -rf /c" }, o);
	expectAllow("bash", { command: "rm -rf build node_modules" }, o);
	expectAllow("bash", { command: "find . -name '*.log' -delete" }, o);
});

test("Sanctuary: an eval worktree under E: is protected the same way", () => {
	const o = opts(WT_SANCTUARY);
	expectBlock("write", { path: "data/identity/x.md", content: "x" }, o);
	expectBlock("bash", { command: "rm -rf sanctuary/data" }, o);
	expectBlock("bash", { command: "git clean -fd" }, o);
	expectAllow("write", { path: "sanctuary/core/x.py", content: "x" }, o);
	expectAllow("bash", { command: "uv run pytest sanctuary/tests -q" }, o);
});

// ---- LuthiModel -------------------------------------------------------------

test("LuthiModel: runs/, checkpoints and archive drives are blocked", () => {
	const o = opts(LUTHIMODEL);
	for (const path of [
		"runs/jepa_pilot/ckpt.pt",
		"runs",
		"checkpoints/model.luthi",
		"E:\\runs\\jepa\\x",
		"e:/runs/a",
		"/e/luthi_experiment_archive/2026-10-01_x/model.luthi",
	]) {
		expectBlock("write", { path, content: "x" }, o);
	}
	for (const command of [
		"rm -rf runs",
		"rm runs/old/*.pt",
		"rm model.luthi",
		"del E:\\runs\\x",
		"robocopy E:\\runs\\a E:\\b /MOVE",
		"git clean -fdX",
		"rm -rf /e/luthi_experiment_archive/old",
		"rm -rf ./*",
		"find . -name '*.luthi' -delete",
		"find . -name '*.pyc' -delete",
		"rm -rf $LUTHI_RUNS_ROOT",
	]) {
		expectBlock("bash", { command }, o);
	}
});

test("LuthiModel: Sanctuary's rules do not misfire here", () => {
	const o = opts(LUTHIMODEL);
	for (const path of ["data/corpus/x.txt", "docs/charter.md", "luthi/model.py", "tests/test_x.py", "runs_meta/2026-10-x.json"]) {
		expectAllow("write", { path, content: "x" }, o);
	}
	for (const command of [
		"LUTHI_BACKEND=cpu LUTHI_ALLOW_CPU=1 uv run python -m pytest tests/ -q",
		"rm data/tmp_cache.bin",
		"cp runs_meta/a.json /tmp/a.json",
		"echo x > data/notes.txt",
		"git checkout -- luthi/model.py",
		"git reset --hard HEAD",
	]) {
		expectAllow("bash", { command }, o);
	}
});

test("Crossing repos: a command run from LuthiModel can't reach Sanctuary's data", () => {
	const o = opts(LUTHIMODEL);
	expectBlock("bash", { command: "rm -rf ../sanctuary/data" }, o);
	expectBlock("bash", { command: "cd ../sanctuary && rm -rf data" }, o);
	expectBlock("write", { path: "../sanctuary/data/x.json", content: "x" }, o);
	expectBlock("write", { path: "C:\\Dev\\sanctuary\\sanctuary\\data\\x.json", content: "x" }, o);
});

// ---- Pi's own configuration -------------------------------------------------

test("Pi's config and this guard can't be changed by the agent", () => {
	const o = opts(LUTHICODE);
	expectBlock("write", { path: "C:\\Users\\Brian\\.pi\\agent\\settings.json", content: "{}" }, o);
	expectBlock("write", { path: "~/.pi/agent/extensions/protect-paths.ts", content: "" }, o);
	expectBlock("write", { path: "/c/Users/Brian/.pi/agent/AGENTS.md", content: "" }, o);
	expectBlock("bash", { command: "rm -rf ~/.pi/agent/extensions" }, o);
	expectBlock("bash", { command: "del %USERPROFILE%\\.pi\\agent\\settings.json" }, o);
	expectBlock("bash", { command: "echo {} > C:/Users/Brian/.pi/agent/models.json" }, o);
	expectBlock("bash", { command: "rm -rf $HOME/.pi/agent" }, o);
	// Harness memory and LuthiCode's own source stay editable.
	expectAllow("write", { path: "C:\\Users\\Brian\\.pi\\agent\\memory\\notes.md", content: "x" }, o);
	expectAllow("write", { path: "extensions/protect-paths.ts", content: "x" }, o);
	expectAllow("bash", { command: "rm -rf node_modules" }, o);
});

test("PI_CODING_AGENT_DIR moves the protected config with it", () => {
	const o = opts(LUTHICODE, { env: { ...ENV, PI_CODING_AGENT_DIR: "D:\\pi-agent" } });
	expectBlock("write", { path: "D:\\pi-agent\\settings.json", content: "{}" }, o);
});

test("LUTHI_RUNS_ROOT is protected when set", () => {
	const o = opts(LUTHIMODEL, { env: { ...ENV, LUTHI_RUNS_ROOT: "F:\\luthi_runs" } });
	expectBlock("write", { path: "F:\\luthi_runs\\jepa\\x.pt", content: "x" }, o);
});

// ---- custom and MCP tools ---------------------------------------------------

test("Custom and MCP tools are checked by their path and command fields", () => {
	const o = opts(SANCTUARY);
	expectBlock("mcp__fs__write_file", { path: "sanctuary/data/x.json", content: "x" }, o);
	expectBlock("some_tool", { options: { destination: "data/identity/x.md" } }, o);
	expectBlock("runner", { command: "rm -rf .memories" }, o);
	expectAllow("mcp__fs__write_file", { path: "sanctuary/core/x.py", content: "x" }, o);
	const readOnly = opts(SANCTUARY, { isReadOnlyTool: (n) => n === "mcp__fs__read_file" });
	expectAllow("mcp__fs__read_file", { path: "sanctuary/data/x.json" }, readOnly);
});

// ---- the real filesystem ----------------------------------------------------

test("Works against a real directory tree (node fs, POSIX paths)", () => {
	const root = mkdtempSync(join(tmpdir(), "protect-paths-"));
	const sanctuary = join(root, "sanctuary-checkout");
	mkdirSync(join(sanctuary, "sanctuary", "data"), { recursive: true });
	writeFileSync(join(sanctuary, "pyproject.toml"), '[project]\nname = "sanctuary"\n');
	const o: Options = { cwd: sanctuary, home: root, env: {} };
	expectBlock("write", { path: "sanctuary/data/x.json", content: "x" }, o);
	expectBlock("write", { path: join(sanctuary, "data", "charter.md"), content: "x" }, o);
	expectBlock("bash", { command: "rm -rf data" }, o);
	expectAllow("write", { path: "sanctuary/core/x.py", content: "x" }, o);
	expectAllow("bash", { command: "rm sanctuary/core/x.py" }, o);
});

test("cmd-style flags like /E aren't mistaken for drive roots", () => {
	// /E would otherwise read as E:\, which holds the protected runs archive.
	expectAllow("bash", { command: "robocopy C:\\Dev\\luthicode\\build C:\\Dev\\luthicode\\dist /E /MIR" }, opts(LUTHICODE));
});

test("Huge dependency folders aren't scanned, so deleting them isn't blocked", () => {
	const many = Array.from({ length: 30000 }, (_, i) => ({ name: `pkg${i}`, dir: false }));
	const big: Fs = { ...win, list: (p) => (p.toLowerCase().endsWith("/node_modules") ? many : (win.list?.(p) ?? null)) };
	expectAllow("bash", { command: "rm -rf node_modules" }, opts(LUTHICODE, { fs: big }));
	// But a huge ordinary folder fails closed.
	const bigBuild: Fs = { ...win, list: (p) => (p.toLowerCase().endsWith("/build") ? many : (win.list?.(p) ?? null)) };
	expectBlock("bash", { command: "rm -rf build" }, opts(LUTHICODE, { fs: bigBuild }));
});


// ---- the workspace: everything outside the task's repo is read-only --------

test("Workspace: the agent can't change the OS, other folders or other repos", () => {
	const o = opts(SANCTUARY);
	for (const path of [
		"C:\\Windows\\System32\\drivers\\etc\\hosts",
		"/c/Program Files/Git/etc/bash.bashrc",
		"C:\\Users\\Brian\\Documents\\taxes.xlsx",
		"~/Desktop/note.txt",
		"C:\\Dev\\luthicode\\README.md",
		"../luthicode/README.md",
		"E:\\other\\x.txt",
	]) {
		expectBlock("write", { path, content: "x" }, o);
	}
	for (const command of [
		"rm -rf /",
		"rm -rf /c/Windows",
		"rm -rf C:\\Windows\\System32",
		"del /s /q C:\\Windows\\Temp\\*",
		"rm -rf ~",
		"rm -rf ~/Documents",
		"cd /c/Windows && rm -rf System32",
		"cp sanctuary/core/a.py C:/Users/Brian/Documents/",
		"echo x > /c/Users/Brian/Desktop/x.txt",
		"mv sanctuary/core/a.py ../elsewhere.py",
		"Remove-Item -Recurse C:\\Users\\Brian\\Documents",
		"curl -o C:/Windows/x.exe https://example.com/x",
		"tar -xf a.tar -C /c/Users/Brian",
		"git clone https://github.com/x/y C:/Users/Brian/y",
		"python -c \"import shutil; shutil.rmtree('C:/Users/Brian/Documents')\"",
		'rm "$HOME/x"',
	]) {
		expectBlock("bash", { command }, o);
	}
});

test("Workspace: ordinary work inside the repo, temp folders and reads elsewhere are fine", () => {
	const o = opts(SANCTUARY);
	for (const path of ["sanctuary/core/new.py", "C:\\Users\\Brian\\AppData\\Local\\Temp\\scratch.txt", "/tmp/scratch.txt", "C:\\Users\\Brian\\.pi\\agent\\memory\\notes.md"]) {
		expectAllow("write", { path, content: "x" }, o);
	}
	for (const command of [
		"cp ~/.gitconfig ./gitconfig.sample",
		"cp ../luthimodel/luthi/sanctuary_interface.py /tmp/",
		"cat /c/Windows/System32/drivers/etc/hosts",
		"echo $PATH > path.txt",
		"python -m pytest sanctuary/tests -q > /tmp/out.txt",
		"tar -czf /tmp/core.tgz sanctuary/core",
		"git clone https://github.com/x/y vendor/y",
		"kill 12345",
		"taskkill /PID 12345 /F",
	]) {
		expectAllow("bash", { command }, o);
	}
	expectAllow("read", { path: "C:\\Windows\\System32\\drivers\\etc\\hosts" }, o);
});

test("Workspace: eval worktrees are their own workspace", () => {
	const o = opts(WT_SANCTUARY);
	expectAllow("write", { path: "sanctuary/core/x.py", content: "x" }, o);
	expectBlock("write", { path: "C:\\Dev\\sanctuary\\sanctuary\\core\\x.py", content: "x" }, o);
});

test("Workspace: Pi started in a home folder or drive root can't change anything", () => {
	for (const cwd of ["C:\\Users\\Brian", "C:\\", "C:\\Windows\\System32", "/"]) {
		const o = opts(cwd);
		expectBlock("write", { path: "x.txt", content: "x" }, o);
		expectBlock("bash", { command: "touch x.txt" }, o);
		expectAllow("write", { path: "C:\\Users\\Brian\\AppData\\Local\\Temp\\x.txt", content: "x" }, o);
	}
});

test("Workspace: extra folders can be granted with LUTHICODE_WORKSPACES", () => {
	const o = opts(SANCTUARY, { env: { ...ENV, LUTHICODE_WORKSPACES: "C:\\Dev\\luthimodel" } });
	expectAllow("write", { path: "C:\\Dev\\luthimodel\\luthi\\model.py", content: "x" }, o);
	expectBlock("write", { path: "C:\\Dev\\luthimodel\\runs\\x.pt", content: "x" }, o); // still protected
	expectBlock("write", { path: "C:\\Dev\\luthicode\\README.md", content: "x" }, o);
});

// ---- commands that change the machine itself ---------------------------------

test("Machine-level commands are blocked everywhere", () => {
	const o = opts(LUTHICODE);
	for (const command of [
		"shutdown /s /t 0",
		"Restart-Computer -Force",
		"format D: /q",
		"diskpart /s script.txt",
		"bcdedit /set {default} safeboot minimal",
		"reg delete HKLM\\Software\\X /f",
		"Set-ItemProperty -Path HKCU:\\Software\\X -Name y -Value 1",
		"setx PATH C:\\x",
		"sc delete WinDefend",
		"Stop-Service -Name Spooler",
		"schtasks /create /tn x /tr calc.exe /sc onlogon",
		"net user hacker pass /add",
		"icacls C:\\Dev /grant Everyone:F",
		"Set-ExecutionPolicy Unrestricted",
		"Add-MpPreference -ExclusionPath C:\\",
		"winget install x",
		"choco uninstall git",
		"npm install -g some-tool",
		"pnpm add --global x",
		"pip install requests",
		"python -m pip install --user x",
		"uv tool install ruff",
		"cargo install ripgrep",
		"sudo rm -rf build",
		"runas /user:Administrator cmd",
		'Start-Process pwsh -Verb RunAs',
		"pkill python",
		"taskkill /F /IM llama-server.exe",
		"Stop-Process -Name llama-server",
		"kill -9 -1",
		"docker volume prune -f",
		"docker system prune -a",
		"docker compose down -v",
		"docker volume rm sanctuary_data",
		"git config --global user.name x",
		"wsl --unregister Ubuntu",
		'bash -c "shutdown -h now"',
	]) {
		expectBlock("bash", { command }, o);
	}
	for (const command of [
		"uv pip install -e .",
		"uv add numpy",
		"uv sync",
		"npm install",
		"npm install --save-dev vitest",
		"git config user.name x",
		"docker compose up -d",
		"docker compose down",
		'git commit -m "shutdown handler: format the reg add output"',
		"python -c \"print('{}'.format(1))\"",
	]) {
		expectAllow("bash", { command }, o);
	}
});

test("Workspace: git commands that create folders must create them inside", () => {
	const o = opts(LUTHICODE);
	expectBlock("bash", { command: "git worktree add C:/Users/Brian/wt main" }, o);
	expectBlock("bash", { command: "git init /c/Users/Brian/newrepo" }, o);
	expectAllow("bash", { command: "git worktree add .worktrees/task-1 main" }, o);
	expectAllow("bash", { command: "git init scratch-repo" }, o);
});

test("Workspace: starting Pi in a subfolder still makes the whole repo the workspace", () => {
	const o = opts("C:\\Dev\\sanctuary\\sanctuary\\core");
	expectAllow("write", { path: "../../docs/research/x.md", content: "x" }, o);
	expectAllow("write", { path: "C:\\Dev\\sanctuary\\README.md", content: "x" }, o);
	expectBlock("write", { path: "../../data/identity/x.md", content: "x" }, o);
	expectBlock("write", { path: "C:\\Dev\\luthicode\\README.md", content: "x" }, o);
});
