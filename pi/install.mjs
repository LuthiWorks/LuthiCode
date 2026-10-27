// Install LuthiCode's Pi setup into Pi's agent folder, on any OS.
//
//   node pi/install.mjs [--dest <folder>] [--platform win32|linux|darwin]
//
// Installs into PI_CODING_AGENT_DIR, or ~/.pi/agent (on Windows,
// %USERPROFILE%\.pi\agent). Any existing file is first saved beside it as .bak.
// Run it again after pulling changes to LuthiCode, or after changing
// server/server.json.
//
//   models.json      Pi's model list, pointed at the local server. The context
//                    window and address come from server/server.json, so they
//                    are set in one place.
//   settings.json    Pi's defaults.
//   AGENTS.md        the brief the local model reads in every repo, from
//                    AGENTS.global.md with this machine's OS and shell filled in.
//   extensions/      only the extensions in EXTENSIONS: ones that have earned
//                    their place in the eval. The others are loaded by the eval
//                    on request (run.mjs --extension <name>) until a comparison
//                    against the baseline shows they help.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "../server/start-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

export const EXTENSIONS = ["protect-paths"];

const PLATFORM_TEXT = {
	win32: { MACHINE: "Brian's Windows PC", SHELL: "Your shell is Git Bash: use Unix commands and forward slashes in paths." },
	linux: { MACHINE: "Brian's Linux machine", SHELL: "Your shell is bash." },
	darwin: { MACHINE: "Brian's Mac", SHELL: "Your shell is bash or zsh. macOS tools are the BSD versions: `sed -i ''`, not `sed -i`." },
};

/** The brief with this platform's lines filled in. */
export function renderBrief(template, platform) {
	const text = PLATFORM_TEXT[platform];
	if (!text) throw new Error(`unknown platform ${platform}; expected one of ${Object.keys(PLATFORM_TEXT).join(", ")}`);
	const out = template.replace(/\{\{(\w+)\}\}/g, (m, k) => {
		if (!(k in text)) throw new Error(`AGENTS.global.md has an unknown placeholder ${m}`);
		return text[k];
	});
	return out;
}

/** Pi's models.json with the context window and address taken from the server config. */
export function renderModels(models, server) {
	const host = server.host === "0.0.0.0" ? "127.0.0.1" : server.host;
	const out = structuredClone(models);
	for (const p of Object.values(out.providers)) {
		p.baseUrl = `http://${host}:${server.port}/v1`;
		for (const m of p.models) m.contextWindow = server.ctx;
	}
	return out;
}

function backupAndWrite(path, content) {
	if (existsSync(path)) copyFileSync(path, `${path}.bak`);
	writeFileSync(path, content);
}

export function install({ dest, platform = process.platform, log = console.log } = {}) {
	const target = dest ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	mkdirSync(join(target, "extensions"), { recursive: true });
	const server = loadServerConfig(join(repo, "server"));

	const models = renderModels(JSON.parse(readFileSync(join(here, "models.json"), "utf-8")), server);
	backupAndWrite(join(target, "models.json"), JSON.stringify(models, null, 2) + "\n");
	log(`Installed models.json (context window ${server.ctx}, server ${models.providers["llama-cpp"].baseUrl})`);

	backupAndWrite(join(target, "settings.json"), readFileSync(join(here, "settings.json"), "utf-8"));
	log("Installed settings.json");

	backupAndWrite(join(target, "AGENTS.md"), renderBrief(readFileSync(join(here, "AGENTS.global.md"), "utf-8"), platform));
	log(`Installed AGENTS.md (${PLATFORM_TEXT[platform].MACHINE})`);

	for (const name of EXTENSIONS) {
		backupAndWrite(join(target, "extensions", `${name}.ts`), readFileSync(join(repo, "extensions", `${name}.ts`), "utf-8"));
		log(`Installed extension ${name}.ts`);
	}
	return target;
}

function main() {
	const argv = process.argv.slice(2);
	const opt = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const target = install({ dest: opt("--dest"), platform: opt("--platform") ?? process.platform });
	console.log(`\nDone: ${target}. Restart Pi if it was running.`);
	console.log(`To check the guard: node "${join(repo, "extensions", "tests", "protect-paths.e2e.mjs")}"`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
