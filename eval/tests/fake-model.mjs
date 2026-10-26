// A scripted stand-in for llama-server, for testing the harness without a model.
// It speaks the OpenAI chat-completions API (streaming), and answers each
// request with the next scripted step: a tool call or a final text.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {Array<{tool: string, args: object} | {text: string}>} steps
 * @returns {Promise<{ port: number, requests: object[], close: () => Promise<void>, writeAgentDir: (dir: string) => void }>}
 */
export async function startFakeModel(steps) {
	const requests = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			if (!req.url.endsWith("/chat/completions")) {
				res.writeHead(404).end();
				return;
			}
			const parsed = JSON.parse(body || "{}");
			requests.push(parsed);
			const step = steps[Math.min(requests.length - 1, steps.length - 1)];
			const base = { id: `r${requests.length}`, object: "chat.completion.chunk", created: 0, model: "fake" };
			const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
			let chunks;
			if (step.tool) {
				const call = { index: 0, id: `call_${requests.length}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } };
				chunks = [
					{ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
					{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage },
				];
			} else {
				chunks = [
					{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: step.text }, finish_reason: null }] },
					{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
				];
			}
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	return {
		port,
		requests,
		close: () => new Promise((r) => server.close(() => r())),
		/** A Pi agent folder whose default model is this fake server. */
		writeAgentDir(dir) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "models.json"),
				JSON.stringify({
					providers: {
						fake: {
							baseUrl: `http://127.0.0.1:${port}/v1`,
							api: "openai-completions",
							apiKey: "local",
							compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
							models: [{ id: "fake", name: "Fake", input: ["text"], reasoning: false, contextWindow: 32768, maxTokens: 1024 }],
						},
					},
				}),
			);
			writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "fake", defaultModel: "fake", defaultThinkingLevel: "off" }));
		},
	};
}

/** The text of the last tool result Pi sent to the model before request n (1-based). */
export function toolResultBefore(requests, n) {
	const msgs = requests[n - 1]?.messages ?? [];
	const tool = [...msgs].reverse().find((m) => m.role === "tool");
	if (!tool) return "";
	return typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content);
}
