import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const endpoint = "https://developerknowledge.googleapis.com/mcp";
const configuredKeyPath = process.env.MATERIA_GOOGLE_DEVELOPER_KNOWLEDGE_KEY_FILE?.trim();
const keyPath = configuredKeyPath || path.join(os.homedir(), ".config", "materia", "google-developer-knowledge.key");
const apiKey = (await readFile(keyPath, "utf8")).trim();

if (!apiKey) {
  throw new Error(`Google Developer Knowledge API key is empty: ${keyPath}`);
}

let sessionId;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

for await (const line of input) {
  if (!line.trim()) continue;

  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    console.error(`Ignoring invalid JSON-RPC input: ${error.message}`);
    continue;
  }

  try {
    await forward(request);
  } catch (error) {
    if (request.id === undefined) {
      console.error(error.message);
      continue;
    }

    writeMessage({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error.message },
    });
  }
}

async function forward(request) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });

  const nextSessionId = response.headers.get("mcp-session-id");
  if (nextSessionId) sessionId = nextSessionId;

  const body = await response.text();
  if (!response.ok) {
    const detail = body.trim().slice(0, 500) || response.statusText;
    throw new Error(`Google Developer Knowledge MCP returned HTTP ${response.status}: ${detail}`);
  }
  if (!body.trim()) return;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    for (const eventLine of body.split(/\r?\n/)) {
      if (!eventLine.startsWith("data:")) continue;
      const data = eventLine.slice(5).trim();
      if (data && data !== "[DONE]") writeMessage(JSON.parse(data));
    }
    return;
  }

  writeMessage(JSON.parse(body));
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
