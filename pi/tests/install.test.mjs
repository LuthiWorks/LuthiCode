// Tests for pi/install.mjs. Installs into a temporary folder; touches nothing else.
// Run: node --test pi/tests/install.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONS, install, renderBrief } from "../install.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const server = JSON.parse(readFileSync(join(repo, "server", "server.json"), "utf-8"));

for (const platform of ["win32", "linux", "darwin"]) {
	test(`install for ${platform}`, () => {
		const dest = mkdtempSync(join(tmpdir(), "pi-install-"));
		try {
			install({ dest, platform, log: () => {} });
			const brief = readFileSync(join(dest, "AGENTS.md"), "utf-8");
			assert.doesNotMatch(brief, /\{\{/, "a placeholder was left in the brief");
			assert.match(brief, platform === "win32" ? /Windows PC[\s\S]*Git Bash/ : platform === "darwin" ? /Mac[\s\S]*BSD/ : /Linux machine[\s\S]*bash/);
			const models = JSON.parse(readFileSync(join(dest, "models.json"), "utf-8"));
			for (const m of models.providers["llama-cpp"].models) assert.equal(m.contextWindow, server.ctx, "context window must come from server.json");
			assert.equal(models.providers["llama-cpp"].baseUrl, `http://${server.host}:${server.port}/v1`);
			assert.deepEqual(readdirSync(join(dest, "extensions")).sort(), EXTENSIONS.map((n) => `${n}.ts`).sort());
			assert.ok(existsSync(join(dest, "settings.json")));
		} finally {
			rmSync(dest, { recursive: true, force: true });
		}
	});
}

test("existing files are saved as .bak before being replaced", () => {
	const dest = mkdtempSync(join(tmpdir(), "pi-install-"));
	try {
		writeFileSync(join(dest, "AGENTS.md"), "my own notes\n");
		install({ dest, platform: "linux", log: () => {} });
		assert.equal(readFileSync(join(dest, "AGENTS.md.bak"), "utf-8"), "my own notes\n");
	} finally {
		rmSync(dest, { recursive: true, force: true });
	}
});

test("an unknown platform or placeholder is refused", () => {
	assert.throws(() => renderBrief("x", "plan9"), /unknown platform/);
	assert.throws(() => renderBrief("{{NOPE}}", "linux"), /unknown placeholder/);
});
