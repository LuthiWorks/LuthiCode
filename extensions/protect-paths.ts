/**
 * protect-paths: LuthiCode's guard for protected files.
 *
 * Pi runs tools without asking first, and Sanctuary's Claude Code hook
 * (.claude/hooks/protect-paths.ps1) does not run under Pi. This extension is
 * the enforcement the local agent has. It blocks tool calls that would modify:
 *
 *   Sanctuary (rules from Sanctuary's CLAUDE.md, "Protected Files"):
 *     - sanctuary/data/, data/ (repo root), any .memories/ folder
 *     - any path naming constitutional, charter, rights or sovereignty
 *     - journal-like JSON (.json/.jsonl under journal(s)/memory/memories)
 *     - Sanctuary's own Claude Code guard (.claude/hooks/, .claude/settings.json)
 *     - whole-tree git commands that discard work (clean, reset --hard, stash,
 *       checkout .), and ones that switch to or bring in other commits
 *       (checkout <ref>, switch, pull, merge, rebase, ...), which rewrite
 *       tracked entity data without naming it
 *   LuthiModel (rules from LuthiModel's CLAUDE.md, "Conventions"):
 *     - runs/ (repo root), any *.luthi checkpoint
 *     - the archive and output drives: E:\runs, E:\luthi_experiment_archive,
 *       and $LUTHI_RUNS_ROOT if set
 *     - git clean (it can delete untracked or ignored checkpoints)
 *   Everywhere:
 *     - Pi's own config: <agent dir>/extensions/, settings.json, models.json,
 *       AGENTS.md (so the agent cannot switch this guard off)
 *
 * Shell commands are checked through nested shells (bash -c, cmd /c,
 * powershell -Command), inline code (python -c), wildcards, and bulk deletes or
 * moves of folders that contain protected files. In the protected repos, a
 * mutating command whose targets can't be seen (variables, xargs) is blocked.
 *
 * Beyond those files, the agent may only change files inside its task's
 * workspace: the git repo (or worktree) Pi was started in, plus temp folders
 * and the harness memory folder. Everything else on the machine is read-only
 * to it. Commands that change the machine itself (shutdown, disks, registry,
 * services, global installs, elevation, killing processes by name, Docker
 * volume pruning) are blocked everywhere.
 *
 * Reading is never blocked. The rule is "do not modify", not "do not look".
 *
 * This guards against mistakes, not against an adversary. It cannot see what
 * a script does when the agent runs it (python some_script.py), and it reads
 * shell commands as text. See docs/decisions.md for the known gaps.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix } from "node:path";

// ---------------------------------------------------------------- types

export type RepoKind = "sanctuary" | "luthimodel";

export interface DirEntry {
	name: string;
	dir: boolean;
}

export interface Fs {
	exists(path: string): boolean;
	read(path: string): string;
	/** Directory listing, or null if the path isn't a readable directory. */
	list?(path: string): DirEntry[] | null;
}

export interface Options {
	cwd: string;
	/** Pi's agent directory (default %USERPROFILE%/.pi/agent or $PI_CODING_AGENT_DIR). */
	agentDir?: string;
	env?: Record<string, string | undefined>;
	home?: string;
	fs?: Fs;
	/** Tool annotations lookup for custom tools (readOnlyHint). */
	isReadOnlyTool?: (toolName: string) => boolean;
	/** Extra folders the agent may change, besides the repo it was started in ($LUTHICODE_WORKSPACES, ;-separated). */
	workspaces?: string[];
}

export type Decision = { block: false } | { block: true; reason: string };

const ALLOW: Decision = { block: false };

const nodeFs: Fs = {
	exists: (p) => existsSync(p),
	read: (p) => readFileSync(p, "utf-8"),
	list: (p) => {
		try {
			return readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
		} catch {
			// Not a directory, or not readable: there is nothing to list.
			return null;
		}
	},
};

// ---------------------------------------------------------------- paths

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Turn any path form the model might use into one comparable shape:
 * forward slashes, lowercase drive letter, "." and ".." resolved.
 * Handles C:\x, C:/x, /c/x, /mnt/c/x, /cygdrive/c/x, ~, @-prefix, file://.
 * Keeps the original letter case (needed to touch the real filesystem);
 * compare with key() for case-insensitive matching, as Windows does.
 */
export function normalizePath(input: string, base: string, home: string): string {
	let p = input.trim().replace(UNICODE_SPACES, " ");
	p = p.replace(/^['"]|['"]$/g, "");
	if (p.startsWith("@")) p = p.slice(1);
	// Windows device-namespace prefixes: \\?\C:\x and \\.\C:\x mean C:\x.
	p = p.replace(/^[\\/]{2}[?.][\\/](?=[a-z]:)/i, "");
	if (/^file:\/\//i.test(p)) {
		p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, ""));
		if (!/^[a-z]:/i.test(p)) p = "/" + p;
	}
	p = p.replace(/\\/g, "/");
	if (p === "~" || p.startsWith("~/")) p = toSlash(home) + p.slice(1);
	const shell = p.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(\/.*)?$/i);
	if (shell && !p.startsWith("//")) p = `${shell[1]}:${shell[2] ?? "/"}`;
	if (!isAbsolute(p)) p = toSlash(normalizePath(base, "/", home)) + "/" + p;
	return resolveDots(p);
}

function toSlash(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsolute(p: string): boolean {
	return p.startsWith("/") || /^[a-z]:\//i.test(p) || /^[a-z]:$/i.test(p);
}

function resolveDots(p: string): string {
	const drive = p.match(/^([a-z]):/i);
	const rest = drive ? p.slice(2) : p;
	const resolved = posix.normalize(rest.startsWith("/") ? rest : "/" + rest).replace(/\/+$/, "") || "/";
	return drive ? `${drive[1].toLowerCase()}:${resolved}` : resolved;
}

/** Case-insensitive comparison key. */
export function key(p: string): string {
	return p.toLowerCase();
}

function parent(p: string): string | null {
	const drive = p.match(/^[a-z]:/i)?.[0] ?? "";
	const rest = p.slice(drive.length);
	if (rest === "/" || rest === "") return null;
	const up = rest.replace(/\/[^/]*$/, "") || "/";
	return drive + up;
}

function join(dir: string, name: string): string {
	return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

// ---------------------------------------------------------------- repos

export interface RepoHit {
	kind: RepoKind;
	root: string;
	/** Path relative to the repo root, lowercase, forward slashes. */
	rel: string;
}

const repoCache = new Map<string, RepoKind | null>();

/** Which LuthiWorks repo, if any, is this directory the root of? */
function repoKindAt(dir: string, fs: Fs): RepoKind | null {
	const cacheKey = key(dir);
	if (fs === nodeFs && repoCache.has(cacheKey)) return repoCache.get(cacheKey) ?? null;
	let kind: RepoKind | null = null;
	const pyproject = join(dir, "pyproject.toml");
	if (fs.exists(pyproject)) {
		const name = fs.read(pyproject).match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1]?.toLowerCase();
		if (name === "sanctuary") kind = "sanctuary";
		else if (name === "luthi") kind = "luthimodel";
	}
	// Fallback markers, in case a pyproject is renamed or missing.
	if (!kind && fs.exists(join(dir, ".claude/hooks/protect-paths.ps1")) && fs.exists(join(dir, "sanctuary"))) {
		kind = "sanctuary";
	}
	if (!kind && fs.exists(join(dir, "luthi/sanctuary_interface.py"))) kind = "luthimodel";
	if (fs === nodeFs) repoCache.set(cacheKey, kind);
	return kind;
}

/** Walk up from a path to the LuthiWorks repo that contains it. */
export function findRepo(path: string, fs: Fs): RepoHit | null {
	let dir: string | null = path;
	while (dir) {
		const kind = repoKindAt(dir, fs);
		if (kind) {
			const rel = key(path === dir ? "" : path.slice(dir.length).replace(/^\/+/, ""));
			return { kind, root: dir, rel };
		}
		dir = parent(dir);
	}
	return null;
}

// ---------------------------------------------------------------- path rules

const NAME_TOKENS = /constitutional|charter|rights|sovereignty/;
const JOURNAL_JSON = /(^|\/)(journal|journals|memories|memory)\/(.+\/)?[^/]+\.jsonl?$/;

/** The rule a path breaks, or null if it may be modified. */
export function pathRule(absPath: string, opts: Required<Pick<Options, "agentDir" | "env">> & { fs: Fs }): string | null {
	const k = key(absPath);

	// Everywhere: Pi's own configuration, so the guard can't be switched off.
	const agent = key(opts.agentDir);
	if (k === agent || k.startsWith(agent + "/")) {
		const inside = k.slice(agent.length + 1);
		if (
			inside === "" ||
			inside === "extensions" ||
			inside.startsWith("extensions/") ||
			["settings.json", "models.json", "agents.md", "agents.override.md", "claude.md"].includes(inside)
		) {
			return "Pi's own configuration (it holds this guard)";
		}
	}

	// LuthiModel's output and archive locations, wherever the agent is.
	const roots = ["e:/runs", "e:/luthi_experiment_archive"];
	const runsRoot = opts.env.LUTHI_RUNS_ROOT;
	if (runsRoot) roots.push(key(normalizePath(runsRoot, "/", "/")));
	for (const r of roots) {
		if (k === r || k.startsWith(r + "/")) return "LuthiModel experiment outputs and archives are never modified or deleted";
	}
	if (k.endsWith(".luthi")) return "LuthiModel checkpoints (*.luthi) are irreproducible";

	const repo = findRepo(absPath, opts.fs);
	if (!repo) return null;
	const rel = repo.rel;

	if (repo.kind === "luthimodel") {
		if (rel === "runs" || rel.startsWith("runs/")) return "LuthiModel runs/ holds irreproducible experiment artifacts";
		return null;
	}

	// Sanctuary.
	if (rel === "sanctuary/data" || rel.startsWith("sanctuary/data/")) return "Sanctuary's entity data (sanctuary/data/)";
	if (rel === "data" || rel.startsWith("data/")) return "Sanctuary's constitutional and identity data (data/)";
	if (/(^|\/)\.memories(\/|$)/.test(rel)) return "Sanctuary's persistent memory store (.memories/)";
	if (NAME_TOKENS.test(rel)) return "a Sanctuary file named constitutional, charter, rights or sovereignty";
	if (JOURNAL_JSON.test(rel)) return "journal-like JSON in Sanctuary";
	if (rel === ".claude/settings.json" || rel.startsWith(".claude/hooks/")) return "Sanctuary's own Claude Code guard";
	return null;
}

// ---------------------------------------------------------------- workspace

/** System folders: never a workspace, nor anything inside them. */
const SYSTEM_DIRS = /^([a-z]:\/(windows|program files|program files \(x86\)|programdata)|\/(usr|etc|bin|sbin|lib|lib64|boot|sys|proc|dev|opt|var))(\/|$)/;
/** Folders too broad to be a workspace themselves (but fine to have workspaces inside). */
const BROAD_DIRS = /^([a-z]:\/?|\/|[a-z]:\/users(\/[^/]+)?|\/home(\/[^/]+)?|\/users(\/[^/]+)?|\/root)$/;

function gitRoot(dir: string, fs: Fs): string | null {
	for (let d: string | null = dir; d; d = parent(d)) {
		if (fs.exists(join(d, ".git"))) return d;
	}
	return null;
}

function isBroad(dir: string, home: string): boolean {
	const k = key(dir);
	return BROAD_DIRS.test(k) || SYSTEM_DIRS.test(k) || k === key(normalizePath(home, "/", home));
}

/** The folders this task may change: its repo (or the start folder), plus any extras. */
export function workspaceRoots(cwd: string, home: string, env: Record<string, string | undefined>, fs: Fs, explicit?: string[]): string[] | null {
	const base = normalizePath(cwd, "/", home);
	const extras = explicit ?? (env.LUTHICODE_WORKSPACES ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
	const roots = extras.map((x) => normalizePath(x, base, home)).filter((r) => !isBroad(r, home));
	const root = gitRoot(base, fs) ?? base;
	if (!isBroad(root, home)) roots.unshift(root);
	return roots.length ? roots : null;
}

function tempRoots(env: Record<string, string | undefined>, home: string): string[] {
	const raw = [env.TEMP, env.TMP, env.TMPDIR, tmpdir(), "/tmp", "/var/tmp"].filter((x): x is string => !!x);
	return [...new Set(raw.map((x) => normalizePath(x, "/", home)))].filter((r) => !BROAD_DIRS.test(key(r)));
}

function within(path: string, root: string): boolean {
	const k = key(path);
	const r = key(root);
	return k === r || k.startsWith(r.endsWith("/") ? r : r + "/");
}

/** Why a path is outside what this task may change, or null if it's inside. */
export function workspaceRule(abs: string, ctx: Ctx): string | null {
	const k = key(abs);
	if (/^\/dev\/(null|stdout|stderr|tty|fd\/\d+)$/.test(k) || /^(nul|con)$/.test(posix.basename(k))) return null;
	if (ctx.temps.some((t) => within(abs, t)) || within(abs, ctx.agentDir + "/memory")) return null;
	if (ctx.workspaces === null) {
		return "files outside any task workspace (Pi was started in a folder too broad to be one, such as a drive root, a home folder or a system folder; start Pi inside the project)";
	}
	if (ctx.workspaces.some((w) => within(abs, w))) return null;
	return `a path outside this task's workspace (${ctx.workspaces.join(", ")})`;
}

// ---------------------------------------------------------------- system commands

/** Commands that change the machine rather than files. Blocked everywhere. */
const SYSTEM_COMMANDS: Array<[RegExp, string]> = [
	[/\b(sudo|runas|gsudo|doas)\b|-Verb\s+RunAs\b/i, "elevated commands can change anything on the machine"],
	[/\b(shutdown|reboot|poweroff|halt|logoff)\b|\b(Restart|Stop)-Computer\b/i, "it would shut down or restart the machine"],
	[/\bformat(\.com)?\s+[a-z]:|\b(diskpart|bcdedit|bcdboot|bootrec|mkfs(\.\w+)?|fdisk|parted|sfdisk)\b|\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition|Set-Partition)\b|\bcipher\b[^|;&]*\s\/w\b|\b(vssadmin|wbadmin)\b[^|;&]*\bdelete\b/i, "it would change disks, partitions or boot settings"],
	[/\breg(\.exe)?\s+(add|delete|import|copy|load|unload|restore)\b|\bregedit\b[^|;&]*\s\/s\b|\b(Set|New|Remove|Rename|Clear)-ItemProperty\b|\b(Remove-Item|New-Item|Set-Item|ri|ni)\b[^|;&]*\bHK(LM|CU|CR|U|CC):/i, "it would change the Windows registry"],
	[/\bsetx\b|SetEnvironmentVariable\s*\([^)]*,\s*['"]?(Machine|User)\b/i, "it would change environment variables for the whole machine or account"],
	[/\bsc(\.exe)?\s+(create|delete|config|stop|start|failure)\b|\b(Set|Stop|New|Remove|Restart|Start|Suspend)-Service\b|\bschtasks\b[^|;&]*\/(create|delete|change)\b|\b(Register|Unregister|Set|Disable)-ScheduledTask\b|\bsystemctl\s+(stop|disable|mask|enable|restart)\b/i, "it would change system services or scheduled tasks"],
	[/\bnet(\.exe)?\s+(user|localgroup|share|stop|start|accounts)\b|\bnetsh\b|\b(New|Remove|Set)-Local(User|Group)\b|\bAdd-LocalGroupMember\b|\b(takeown|icacls|cacls)\b|\bSet-Acl\b|\b(Set|Add|Remove)-MpPreference\b|\bSet-ExecutionPolicy\b|\b(New|Set|Remove)-NetFirewallRule\b/i, "it would change accounts, permissions or security settings"],
	[/\b(winget|choco|scoop)\s+(install|uninstall|upgrade|remove)\b|\bmsiexec\b|\b(Install|Uninstall|Update)-(Module|Package|Script)\b|\b(apt|apt-get|dnf|yum|pacman|brew)\s+(install|remove|purge|upgrade)\b/i, "it would install or remove software on the machine"],
	[/\b(npm|pnpm)\s+(i|install|add|uninstall|un|rm|remove|link|update|up)\b[^|;&]*\s(-g|--global)\b|\byarn\s+global\b|\b(uv\s+tool|pipx)\s+(install|uninstall)\b|\b(cargo|go|gem)\s+install\b|\bconda\s+(install|remove|create)\b/i, "global installs change the machine outside this task"],
	// Plain pip installs into whatever Python is first on PATH; uv pip and uv run ... -m pip use the repo's environment.
	[/(?<!\buv\s+(?:run\s+)?(?:python3?(?:\.exe)?\s+-m\s+)?)\bpip3?(?:\.exe)?\s+(?:install|uninstall)\b/i, "pip outside uv changes a shared Python install; use uv in the repo instead (uv add, uv sync, uv pip install)"],
	[/\b(pkill|killall)\b|\btaskkill\b[^|;&]*\/IM\b|\bStop-Process\b[^|;&]*-(Name|ProcessName)\b|\bkill\b[^|;&]*\s-(1|0)(\s|$)/i, "killing processes by name could stop the model server or a training run"],
	[/\bdocker(-compose)?\s+(compose\s+)?(system|volume|container|image|network|builder)\s+(prune|rm)\b|\bdocker\s+volume\s+rm\b|\bdocker(-compose|\s+compose)\b[^|;&]*\bdown\b[^|;&]*\s(-v|--volumes)\b|\bdocker\s+rm\b[^|;&]*\s-[a-z]*v/i, "Docker volumes may hold Sanctuary's entity state"],
	[/\bgit\s+config\b[^|;&]*\s--(global|system)\b/i, "it would change git settings for the whole account or machine"],
	[/\bwsl(\.exe)?\b[^|;&]*\s--(unregister|uninstall)\b/i, "it would delete a WSL distribution"],
];

// ---------------------------------------------------------------- shell commands

interface Ctx {
	cwd: string;
	agentDir: string;
	env: Record<string, string | undefined>;
	home: string;
	fs: Fs;
	/** Folders the agent may change; null when Pi was started somewhere too broad to be a workspace. */
	workspaces: string[] | null;
	/** Temp folders, always writable. */
	temps: string[];
}

/** Anything that can change files. Matched against each command segment. */
const MUTATION_VERBS: RegExp[] = [
	// POSIX and Git Bash
	/\b(rm|rmdir|unlink|mv|cp|ln|install|rsync|truncate|shred|dd|tee|touch|mkdir|chmod|chown|patch)\b/,
	/\b(curl|wget|tar|unzip|gunzip|gzip|zip|7z|7za)\b/,
	/\bsed\b[^|;&]*\s(-i|--in-place)/,
	/\bperl\b[^|;&]*\s-[a-z]*i/,
	/\bfind\b[^|;&]*\s-(delete|exec|execdir|ok)\b/,
	/\bxargs\b/,
	// git commands that change the working tree
	/\bgit\b[^|;&]*\s(rm|mv|restore|clean|apply|stash|reset|checkout|switch|am|merge|rebase|pull|clone|worktree|init|submodule)\b/,
	// cmd.exe
	/\b(del|erase|rd|move|copy|xcopy|robocopy|ren|rename|mklink)\b/i,
	// PowerShell, including its short aliases
	/\b(Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Content|Add-Content|Clear-Content|Out-File)\b/i,
	/\b(ri|mi|cpi|ni|ac|clc|rni)\b/i,
	/\[(System\.)?IO\.(File|Directory|Path)\]::/i,
	/\.(Delete|MoveTo|CopyTo)\s*\(/,
	// inline code in an interpreter can do anything
	/\b(python3?|py|node|deno|bun|perl|ruby)(\.exe)?\b[^|;&]*\s(-c|-e|--eval|-E)\b/,
	/\b(bash|sh|zsh|dash|ksh|pwsh|powershell|cmd)(\.exe)?\b[^|;&]*\s(-[a-z]*c|-Command|-EncodedCommand|\/c|\/k)\b/i,
	/\beval\b/,
];

/** Commands that delete or move whole folders. A folder holding protected files can't be their target. */
const TREE_OPS: RegExp[] = [
	/\brm\b[^|;&]*\s-(?:[a-z]*r|[a-z]*R)[a-z]*\b|\brm\b[^|;&]*\s--recursive\b/,
	/\b(mv|move|ren|rename|Move-Item|mi|Rename-Item|rni)\b/i,
	/\bgit\b[^|;&]*\smv\b/,
	/\bgit\b[^|;&]*\srm\b[^|;&]*\s-[a-z]*r/,
	/\bfind\b[^|;&]*\s-(delete|exec|execdir|ok)\b/,
	/\brsync\b[^|;&]*\s--delete/,
	/\brobocopy\b[^|;&]*\s\/(MIR|PURGE|MOVE|MOV)\b/i,
	/\b(Remove-Item|ri|rm|del)\b[^|;&]*\s-(Recurse|r)\b/i,
	/\b(rd|rmdir|del|erase)\b[^|;&]*\s\/s\b/i,
];

/** Output redirection to a file (not 2>&1). Handles >, >> and >|. */
const REDIRECT = />{1,2}\|?\s*(?!&)(['"]?)([^\s|&;<>'"]+)\1/g;
const NULL_DEVICE = /^(\/dev\/null|nul|\$null)$/i;

function redirectTargets(segment: string): string[] {
	return [...segment.matchAll(new RegExp(REDIRECT.source, "g"))].map((m) => m[2]).filter((t) => !NULL_DEVICE.test(t));
}

/** Segments whose text is a message, not a file operation. */
const MESSAGE_ONLY = /^\s*git(?:\s+-[cC]\s+\S+)*\s+(commit|tag|notes|log|show|diff|status|blame)\b/;

function isMutating(segment: string): boolean {
	if (MESSAGE_ONLY.test(segment) && redirectTargets(segment).length === 0) return false;
	return MUTATION_VERBS.some((v) => v.test(segment)) || redirectTargets(segment).length > 0;
}

/** Sanctuary's token net, ported from protect-paths.ps1 (with ./data/ added). */
const SANCTUARY_TOKENS: Array<[RegExp, string]> = [
	[/sanctuary[/\\]+data\b/i, "Sanctuary's entity data (sanctuary/data/)"],
	[/\.memories/i, "Sanctuary's persistent memory store (.memories/)"],
	[/(?:^|[\s'"=(;|&])(?:\.[/\\])?data[/\\]/i, "Sanctuary's constitutional and identity data (data/)"],
	[/constitutional|charter|rights|sovereignty/i, "a Sanctuary file named constitutional, charter, rights or sovereignty"],
	[/(journal|journals|memories|memory)[/\\][^\s]*\.jsonl?\b/i, "journal-like JSON in Sanctuary"],
	[/\.claude[/\\]+(hooks|settings\.json)/i, "Sanctuary's own Claude Code guard"],
];

/** Applied everywhere: checkpoints, archive drives, and Pi's own config. */
const GLOBAL_TOKENS: Array<[RegExp, string]> = [
	[/\.luthi(?![\w/\\-])/i, "LuthiModel checkpoints (*.luthi) are irreproducible"],
	[/(?:^|[\s'"=(])(?:e:[/\\]+|\/e\/|\/mnt\/e\/)(runs|luthi_experiment_archive)\b/i, "LuthiModel experiment outputs and archives"],
	[/luthi_experiment_archive/i, "LuthiModel experiment outputs and archives"],
	[/\.pi[/\\]+agent(?:[/\\]+(extensions|settings\.json|models\.json|agents\.md|agents\.override\.md|claude\.md)\b|[/\\]*(?=['"\s]|$))/i, "Pi's own configuration (it holds this guard)"],
];

/** Applied when working in LuthiModel or naming it. */
const LUTHIMODEL_TOKENS: Array<[RegExp, string]> = [
	[/(?:^|[\s'"=(;|&])(?:\.[/\\])?runs(?:[/\\]|['"\s]|$)/i, "LuthiModel runs/ holds irreproducible experiment artifacts"],
];

/** git, optionally with -C dir, -c key=val or --flags before the subcommand. */
const GIT = String.raw`\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?))*\s+`;
/** Whole-tree git commands that throw away work, blocked outright in Sanctuary. */
const SANCTUARY_GIT = new RegExp(GIT + String.raw`(clean\b|reset\b[^|;&]*--hard|stash\b|checkout\b[^|;&]*\s(--\s+)?\.(\s|$)|restore\b[^|;&]*\s\.(\s|$)|switch\b[^|;&]*--discard-changes)`);
/**
 * git commands that bring in or switch to other commits rewrite tracked files,
 * including Sanctuary's entity data, without naming them. Creating a branch
 * (checkout -b, switch -c) is allowed; restoring one file uses `git restore <file>`.
 */
const SANCTUARY_GIT_HISTORY = new RegExp(
	GIT + String.raw`(pull|merge|rebase|am|cherry-pick|revert)\b|` + GIT + String.raw`checkout\s+(?!-b\b|-B\b|--orphan\b|--\s)[^|;&\s-]\S*|` + GIT + String.raw`switch\s+(?!-c\b|-C\b|--create\b)`,
);
/** git clean can delete untracked and ignored files, which is where checkpoints live. */
const ANY_REPO_GIT = new RegExp(GIT + String.raw`clean\b`);

/** Split a command into segments at ; && || | and newlines, outside quotes. */
export function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let cur = "";
	let quote: string | null = null;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote) {
			cur += c;
			if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c;
			cur += c;
			continue;
		}
		const next = command[i + 1];
		const clobber = c === "|" && cur.endsWith(">");
		if (!clobber && (c === ";" || c === "\n" || c === "|" || (c === "&" && next === "&"))) {
			if (cur.trim()) segments.push(cur.trim());
			cur = "";
			if ((c === "&" && next === "&") || (c === "|" && next === "|")) i++;
			continue;
		}
		cur += c;
	}
	if (cur.trim()) segments.push(cur.trim());
	return segments;
}

/** Split a segment into words, honoring simple quotes. */
export function words(segment: string): string[] {
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
	return out;
}

const VARIABLE = /\$|%\w+%|`/;
const CMD_VERB = /\b(del|erase|rd|rmdir|copy|xcopy|robocopy|move|ren|rename|mklink|cmd)(\.exe)?\b/i;
const GLOB = /[*?[]/;

/** The command a nested shell will run: bash -c "...", pwsh -Command ..., cmd /c ..., eval ... */
function innerCommands(w: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < w.length; i++) {
		const name = w[i].toLowerCase().replace(/\.exe$/, "");
		const flag = w[i + 1] ?? "";
		if (/^(bash|sh|zsh|dash|ksh)$/.test(name) && /^-[a-z]*c$/.test(flag) && w[i + 2] !== undefined) out.push(w[i + 2]);
		if (/^(pwsh|powershell)$/.test(name)) {
			const at = w.findIndex((x, j) => j > i && /^-(c|command)$/i.test(x));
			if (at > 0) out.push(w.slice(at + 1).join(" "));
			const enc = w.findIndex((x, j) => j > i && /^-(e|ec|encodedcommand)$/i.test(x));
			if (enc > 0 && w[enc + 1]) out.push(Buffer.from(w[enc + 1], "base64").toString("utf16le"));
		}
		if (name === "cmd" && /^\/[ck]$/i.test(flag)) out.push(w.slice(i + 2).join(" "));
		if (name === "eval" && i === 0) out.push(w.slice(1).join(" "));
	}
	return out;
}

/** Inline program text: python -c "...", node -e "...", and the like. */
function inlineCode(w: string[]): string | null {
	for (let i = 0; i < w.length - 2; i++) {
		const name = w[i].toLowerCase().replace(/\.exe$/, "");
		if (/^(python3?(\.\d+)?|py|node|deno|bun|perl|ruby)$/.test(name) && /^(-c|-e|--eval|-E)$/.test(w[i + 1])) return w[i + 2];
	}
	return null;
}

/** Quoted string literals inside program text. */
function stringLiterals(code: string): string[] {
	return [...code.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]).filter((s) => s.length > 0 && s.length < 300);
}

const SKIP_SCAN = new Set([".git", ".venv", "venv", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages", ".tox"]);
const SCAN_LIMIT = 20000;

/**
 * Does this folder hold anything protected? Used before deleting or moving a
 * folder whole. Returns a rule, or null. Fails closed: a tree too big to scan
 * counts as protected.
 */
function folderRule(dir: string, ctx: Ctx): string | null {
	const own = pathRule(dir, ctx);
	if (own) return own;
	const k = key(dir);
	const prefix = k.endsWith("/") ? k : k + "/"; // drive roots ("e:/") already end in a slash
	const isBelow = (other: string) => other.startsWith(prefix);
	if (isBelow(key(ctx.agentDir))) return "a folder that holds Pi's own configuration";
	for (const r of ["e:/runs", "e:/luthi_experiment_archive"]) if (isBelow(r)) return "a folder that holds LuthiModel experiment outputs";
	const list = ctx.fs.list;
	if (!list) return findRepo(dir, ctx.fs) ? "a folder in a protected repo that can't be listed" : null;
	if (SKIP_SCAN.has(posix.basename(k))) return null;
	const queue = [dir];
	let seen = 0;
	while (queue.length) {
		const d = queue.shift() as string;
		const entries = list(d);
		if (!entries) continue;
		for (const e of entries) {
			if (++seen > SCAN_LIMIT) return "a folder too large to check for protected files";
			const p = join(d, e.name);
			const rule = pathRule(p, ctx);
			if (rule) return `a folder that contains ${rule}`;
			if (e.dir && !SKIP_SCAN.has(e.name.toLowerCase())) queue.push(p);
		}
	}
	return null;
}

/** Expand a shell wildcard against the filesystem, as bash would (no dotfiles). */
function expandGlob(pattern: string, ctx: Ctx): string[] | null {
	const list = ctx.fs.list;
	if (!list) return null;
	const parts = pattern.split("/");
	const firstGlob = parts.findIndex((s) => GLOB.test(s));
	const prefix = parts.slice(0, firstGlob).join("/") || "/";
	let current = [/^[a-z]:$/i.test(prefix) ? prefix + "/" : prefix];
	for (const part of parts.slice(firstGlob)) {
		if (!GLOB.test(part)) {
			current = current.map((c) => join(c, part));
			continue;
		}
		const re = new RegExp(
			"^" + part.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*+/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\[!/g, "[^") + "$",
			"i",
		);
		const next: string[] = [];
		for (const c of current) {
			for (const e of list(c) ?? []) {
				if (e.name.startsWith(".") && !part.startsWith(".")) continue;
				if (re.test(e.name)) next.push(join(c, e.name));
			}
		}
		current = next;
		if (current.length > 2000) break;
	}
	return current;
}

/** Words that might name files: arguments, values after "=", and redirect targets. */
function candidateTargets(w: string[], segment: string): string[] {
	const out: string[] = [];
	for (const word of w.slice(1)) {
		if (!word) continue;
		const eq = word.match(/^-{0,2}[\w.-]+=(.+)$/);
		if (eq) out.push(eq[1]);
		if (word.startsWith("-")) continue; // flags
		if (CMD_VERB.test(segment) && /^\/[a-z?]{1,6}(:\S*)?$/i.test(word)) continue; // cmd's /s /q /MIR
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word) && !/^file:/i.test(word)) continue; // URLs
		out.push(word);
	}
	return [...out, ...redirectTargets(segment)];
}

/** Commands whose arguments are all files they change. */
const ALL_ARGS_WRITERS = new Set([
	"rm", "rmdir", "unlink", "mv", "touch", "mkdir", "chmod", "chown", "truncate", "shred", "tee", "attrib", "patch",
	"del", "erase", "rd", "move", "ren", "rename", "mklink",
	"remove-item", "ri", "move-item", "mi", "rename-item", "rni", "new-item", "ni", "set-content", "add-content", "ac", "clear-content", "clc", "out-file",
]);
/** Commands that write only their last argument (the destination). */
const DEST_WRITERS = new Set(["cp", "copy", "xcopy", "copy-item", "cpi", "rsync", "scp", "ln", "install"]);
const PREFIXES = /^(sudo|time|nice|nohup|env|command|builtin|exec|xargs|do|then|else|elif|if|while|until|!|\{|\()$/;

/** The files a segment writes, for the workspace check. Unknown commands: only their redirects. */
function writeTargets(w: string[], segment: string): string[] {
	const out = redirectTargets(segment);
	const i = w.findIndex((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x) && !PREFIXES.test(x));
	if (i < 0) return out;
	const verb = w[i].toLowerCase().replace(/\.exe$/, "");
	const rest = w.slice(i + 1);
	const isFlag = (x: string) => x.startsWith("-") || (CMD_VERB.test(segment) && /^\/[a-z?]{1,6}(:\S*)?$/i.test(x));
	const positional = rest.filter((x) => x && !isFlag(x));
	const after = (flag: RegExp) => {
		const vals: string[] = [];
		rest.forEach((x, j) => {
			const eq = x.match(/^(--?[\w-]+)=(.*)$/);
			if (eq && flag.test(eq[1])) vals.push(eq[2]);
			else if (flag.test(x) && rest[j + 1]) vals.push(rest[j + 1]);
		});
		return vals;
	};
	if (ALL_ARGS_WRITERS.has(verb)) return [...out, ...positional];
	if (DEST_WRITERS.has(verb)) {
		const t = after(/^(-t|--target-directory|-Destination)$/i);
		return [...out, ...(t.length ? t : positional.slice(-1))];
	}
	switch (verb) {
		case "sed":
		case "perl":
			return /\s(-i|--in-place|-[a-z]*i)\b/.test(segment) ? [...out, ...positional.slice(1)] : out;
		case "robocopy":
			return [...out, ...positional.slice(1, 2)];
		case "tar":
			return [...out, ...after(/^(-[a-zA-Z]*f|--file|-C|--directory)$/)];
		case "curl":
			return [...out, ...after(/^(-[a-zA-Z]*o|--output)$/)];
		case "wget":
			return [...out, ...after(/^(-O|--output-document|-P|--directory-prefix)$/)];
		case "unzip":
			return [...out, ...after(/^-d$/)];
		case "7z":
		case "7za":
			return [...out, ...rest.filter((x) => /^-o./.test(x)).map((x) => x.slice(2))];
		case "dd":
			return [...out, ...rest.filter((x) => x.startsWith("of=")).map((x) => x.slice(3))];
		case "find": {
			if (!/\s-(delete|exec|execdir|ok)\b/.test(segment)) return out;
			const starts = rest.slice(0, Math.max(0, rest.findIndex((x) => /^[-(!]/.test(x))));
			return [...out, ...(starts.length ? starts : ["."])];
		}
		case "git": {
			const vals = after(/^-C$/);
			const sub = positional.find((x) => !vals.includes(x));
			const args = sub ? positional.slice(positional.indexOf(sub) + 1) : [];
			if (sub === "clone" && args.length >= 2) vals.push(args[args.length - 1]);
			if (sub === "init" && args.length >= 1) vals.push(args[0]);
			if (sub === "worktree" && args[0] === "add" && args[1]) vals.push(args[1]);
			return [...out, ...vals];
		}
		default:
			return out;
	}
}

export function checkCommand(command: string, opts: Ctx): Decision {
	const rule = commandRule(command, opts, 0);
	return rule ? blocked("bash", command, rule) : ALLOW;
}

/** The protection rule a shell command breaks, or null. */
function commandRule(command: string, opts: Ctx, depth: number, startBase?: string): string | null {
	if (depth > 4) return "the command is nested too deeply to check";
	const segments = splitSegments(command);
	let base = startBase ?? normalizePath(opts.cwd, "/", opts.home);
	const cwdRepo = findRepo(base, opts.fs)?.kind ?? null;
	const namesSanctuary = /sanctuary/i.test(command);
	const namesLuthi = /luthi/i.test(command);

	for (const segment of segments) {
		const w = words(segment);
		if ((w[0] === "cd" || w[0] === "pushd" || w[0] === "Set-Location") && w[1] && !VARIABLE.test(w[1])) {
			base = normalizePath(w[1], base, opts.home);
			continue;
		}
		const here = findRepo(base, opts.fs)?.kind ?? cwdRepo;
		const inSanctuary = here === "sanctuary" || namesSanctuary;
		const inLuthiModel = here === "luthimodel" || namesLuthi;

		// Commands that change the machine itself.
		if (!MESSAGE_ONLY.test(segment)) {
			for (const [re, why] of SYSTEM_COMMANDS) if (re.test(segment)) return why;
		}

		// Nested shells: check the command they will run.
		for (const inner of innerCommands(w)) {
			const rule = commandRule(inner, opts, depth + 1, base);
			if (rule) return rule;
		}

		// Inline code: every string literal that names a protected path counts.
		const code = inlineCode(w);
		if (code !== null) {
			const destructive = /rmtree|rmdir|removedirs|rmSync|rimraf|\bremove\b|\bunlink|\brename|\bmove\b|\breplace\b|\bwrite|\bopen\s*\(|\bcopy|\btruncate/i.test(code);
			for (const lit of stringLiterals(code)) {
				const abs = normalizePath(lit, base, opts.home);
				const rule = pathRule(abs, opts) ?? (destructive ? folderRule(abs, opts) : null);
				if (rule) return modifies(rule);
				if (destructive && /^([a-z]:[\\/]|[\\/]|~[\\/])./i.test(lit)) {
					const outside = workspaceRule(abs, opts);
					if (outside) return modifies(outside);
				}
			}
		}

		if (!isMutating(segment)) continue;

		// Whole-tree git commands that discard work.
		const gitDir = segment.match(new RegExp(String.raw`\bgit\s+(?:[^|;&]*\s)?-C\s+(\S+)`))?.[1];
		const gitRepo = gitDir ? (findRepo(normalizePath(gitDir, base, opts.home), opts.fs)?.kind ?? null) : here;
		if ((gitRepo === "sanctuary" || namesSanctuary) && SANCTUARY_GIT.test(segment)) {
			return "whole-tree git commands like this can destroy Sanctuary's entity data";
		}
		if ((gitRepo === "sanctuary" || namesSanctuary) && SANCTUARY_GIT_HISTORY.test(segment)) {
			return "switching to or bringing in other commits rewrites Sanctuary's tracked entity data (to undo changes to one file, use git restore <file>)";
		}
		if ((gitRepo || namesSanctuary || namesLuthi) && ANY_REPO_GIT.test(segment)) {
			return "git clean can delete untracked or ignored files, including irreproducible checkpoints";
		}

		const known = here !== null || namesSanctuary || namesLuthi;
		// Files piped into xargs can't be seen from here.
		if (known && /\bxargs\b/.test(segment)) {
			return "the files piped into xargs can't be checked (name the files explicitly instead)";
		}

		const tree = TREE_OPS.some((t) => t.test(segment));
		for (const raw of candidateTargets(w, segment)) {
			if (VARIABLE.test(raw)) continue; // judged below, if it's something this segment writes
			const abs = normalizePath(raw, base, opts.home);
			const hits = GLOB.test(raw) ? expandGlob(abs, opts) : [abs];
			if (hits === null) {
				if (known) return "files matched by a wildcard can't be checked here (name the files explicitly instead)";
				continue;
			}
			for (const hit of hits) {
				const rule = pathRule(hit, opts) ?? (tree ? folderRule(hit, opts) : null);
				if (rule) return modifies(rule);
			}
		}

		// Workspace: whatever this segment writes must be inside the task's folders.
		for (const raw of writeTargets(w, segment)) {
			if (VARIABLE.test(raw)) return "files named by a variable or command substitution can't be checked (name the files explicitly instead)";
			// A wildcard can only match paths that share its prefix, so checking the
			// pattern itself is enough; it doesn't need to match anything on disk.
			const outside = workspaceRule(normalizePath(raw, base, opts.home), opts);
			if (outside) return modifies(outside);
		}

		// The token net from Sanctuary's hook, for paths the resolver can't see.
		const nets = [...GLOBAL_TOKENS, ...(inSanctuary ? SANCTUARY_TOKENS : []), ...(inLuthiModel ? LUTHIMODEL_TOKENS : [])];
		for (const [re, rule] of nets) {
			if (re.test(segment)) return modifies(rule);
		}
	}
	return null;
}

// ---------------------------------------------------------------- decide

function modifies(rule: string): string {
	return `it would modify ${rule}`;
}

function blocked(tool: string, target: string, reason: string): Decision {
	return {
		block: true,
		reason:
			`LuthiCode protect-paths blocked this ${tool} call because ${reason}. ` +
			`Target: ${target.length > 300 ? target.slice(0, 300) + "..." : target}. ` +
			"This is protected, and only Brian can approve it. " +
			"Do not retry, and do not reach it another way (another tool, a script, a copy, git). " +
			"Stop and tell Brian what you wanted to change and why.",
	};
}

const PATH_KEYS = /^(path|paths|file|files|file_path|filepath|filename|dir|directory|target|dest|destination|output|out|to|from|source)$/i;
const COMMAND_KEYS = /^(command|cmd|script|code|shell)$/i;

export function decide(toolName: string, input: Record<string, unknown>, options: Options): Decision {
	const env = options.env ?? process.env;
	const home = options.home ?? env.USERPROFILE ?? env.HOME ?? homedir();
	const fs = options.fs ?? nodeFs;
	const agentDir = normalizePath(options.agentDir ?? env.PI_CODING_AGENT_DIR ?? `${toSlash(home)}/.pi/agent`, "/", home);
	const cwd = options.cwd;
	const ctx: Ctx = { cwd, agentDir, env, home, fs, workspaces: workspaceRoots(cwd, home, env, fs, options.workspaces), temps: tempRoots(env, home) };
	const base = normalizePath(cwd, "/", home);
	const fileRule = (p: string) => {
		const abs = normalizePath(p, base, home);
		const rule = pathRule(abs, ctx);
		return rule ? modifies(rule) : (workspaceRule(abs, ctx) ? modifies(workspaceRule(abs, ctx) as string) : null);
	};

	switch (toolName) {
		case "read":
		case "grep":
		case "find":
		case "ls":
			return ALLOW;
		case "write":
		case "edit": {
			const p = typeof input.path === "string" ? input.path : "";
			if (!p) return ALLOW;
			const rule = fileRule(p);
			return rule ? blocked(toolName, p, rule) : ALLOW;
		}
		case "bash":
		case "powershell": {
			const c = typeof input.command === "string" ? input.command : "";
			const d = c ? checkCommand(c, ctx) : ALLOW;
			return d.block ? { block: true, reason: d.reason.replace("this bash call", `this ${toolName} call`) } : ALLOW;
		}
		default: {
			// Custom and MCP tools: check anything that looks like a path or a command,
			// unless the tool declares itself read-only.
			if (options.isReadOnlyTool?.(toolName)) return ALLOW;
			for (const [k, v] of flatten(input)) {
				if (PATH_KEYS.test(k) && typeof v === "string" && v) {
					const rule = fileRule(v);
					if (rule) return blocked(toolName, v, rule);
				}
				if (COMMAND_KEYS.test(k) && typeof v === "string" && v) {
					const d = checkCommand(v, ctx);
					if (d.block) return { block: true, reason: d.reason.replace("this bash call", `this ${toolName} call`) };
				}
			}
			return ALLOW;
		}
	}
}

function* flatten(value: unknown, keyName = ""): Generator<[string, unknown]> {
	if (Array.isArray(value)) {
		for (const v of value) yield* flatten(v, keyName);
	} else if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) yield* flatten(v, k);
	} else {
		yield [keyName, value];
	}
}

// ---------------------------------------------------------------- extension

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const decision = decide(event.toolName, event.input as Record<string, unknown>, {
			cwd: ctx.cwd,
			isReadOnlyTool: (name) => pi.getAllTools().find((t) => t.name === name)?.annotations?.readOnlyHint === true,
		});
		if (!decision.block) return undefined;
		if (ctx.hasUI) ctx.ui.notify("protect-paths blocked a change to a protected file", "warning");
		return { block: true, reason: decision.reason };
	});
}
