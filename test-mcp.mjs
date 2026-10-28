/**
 * Smoke-test: connects to bring-mcp via MCP client,
 * gets the default list, adds "Äpfel" with spec "1", then removes it again.
 *
 * Usage:
 *   node test-mcp.mjs          → adds AND removes (full round-trip)
 *   node test-mcp.mjs --keep   → adds but does NOT remove (so you can verify in the Bring! app)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency needed)
try {
  const env = readFileSync(resolve(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {
  console.error("❌  No .env file found in bring-app/. Create one from .env.example first.");
  process.exit(1);
}

if (!process.env.BRING_EMAIL || !process.env.BRING_PASSWORD) {
  console.error("❌  BRING_EMAIL and BRING_PASSWORD must be set in bring-app/.env");
  process.exit(1);
}

const keep = process.argv.includes("--keep");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "bring-mcp@latest"],
  env: {
    ...process.env,
    BRING_EMAIL: process.env.BRING_EMAIL,
    BRING_PASSWORD: process.env.BRING_PASSWORD,
  },
});

const client = new Client({ name: "bring-smoke-test", version: "1.0.0" });

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`Tool ${name} failed: ${JSON.stringify(res.content)}`);
  // content is an array of {type, text} objects
  const text = res.content.map((c) => c.text ?? "").join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

console.log("🔌  Starting bring-mcp server via npx...");
await client.connect(transport);
console.log("✅  Connected to bring-mcp\n");

// 1. Get default list UUID
console.log("📋  Getting default shopping list...");
const defaultList = await call("getDefaultList", {});
const listId = typeof defaultList === "string" ? defaultList : defaultList?.uuid ?? defaultList?.listUuid ?? JSON.stringify(defaultList);
console.log(`   List UUID: ${listId}\n`);

// 2. Add Äpfel
console.log('🛒  Adding "Äpfel" (spec: "1") to the list...');
await call("saveItem", { listUuid: listId, itemName: "Äpfel", specification: "1" });
console.log('✅  "Äpfel" added! Check your Bring! app now.\n');

if (keep) {
  console.log("ℹ️   --keep flag set — item left on the list for manual verification.");
  console.log('     Run again without --keep to remove it, or delete it in the app.');
} else {
  // Small pause so you can see it in the app if watching
  await new Promise((r) => setTimeout(r, 3000));
  console.log('🗑️   Removing "Äpfel" from the list (clean-up)...');
  await call("removeItem", { listUuid: listId, itemId: "Äpfel" });
  console.log('✅  "Äpfel" removed. Round-trip complete!\n');
}

await client.close();
console.log("🔌  Disconnected. Smoke-test passed ✓");
