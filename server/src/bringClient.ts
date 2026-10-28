import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Ingredient } from "./recipeLoader.js";

let client: Client | null = null;
let listUuid: string | null = null;

async function getClient(): Promise<Client> {
  if (client) return client;

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "bring-mcp@latest"],
    env: {
      ...process.env,
      BRING_EMAIL: process.env.BRING_EMAIL!,
      BRING_PASSWORD: process.env.BRING_PASSWORD!,
    },
  });

  client = new Client({ name: "bring-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const t0 = Date.now();
  console.log(`🔧 MCP call: ${name}`);
  const c = await getClient();
  const res = await c.callTool({ name, arguments: args });
  console.log(`🔧 MCP ${name} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s${res.isError ? " (ERROR)" : ""}`);
  if (res.isError) {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(res.content)}`);
  }
  const text = (res.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
  try { return JSON.parse(text); } catch { return text; }
}

// read lazily: .env is loaded after this module is imported
const configuredListName = () => process.env.BRING_LIST_NAME ?? "Einkauf Supermarkt";
let resolvedListName: string | null = null;

/** Name of the Bring! list the agent writes to (for prompts and replies). */
export function getListName(): string {
  return resolvedListName ?? configuredListName();
}

/** Finds the list called BRING_LIST_NAME (default "Einkauf Supermarkt") via loadLists. */
async function getTargetListUuid(): Promise<string> {
  if (listUuid) return listUuid;
  const result = (await callTool("loadLists", {})) as { lists?: Array<{ listUuid: string; name: string }> };
  const lists = result?.lists ?? [];
  const LIST_NAME = configuredListName();
  const wanted = LIST_NAME.trim().toLowerCase();
  const match = lists.find((l) => l.name.trim().toLowerCase() === wanted);
  if (!match) {
    throw new Error(
      `Bring! list "${LIST_NAME}" not found. Available lists: ${lists.map((l) => `"${l.name}"`).join(", ") || "none"}. ` +
        `Set BRING_LIST_NAME in .env to one of them.`
    );
  }
  listUuid = match.listUuid;
  resolvedListName = match.name;
  console.log(`📋 Using Bring! list "${match.name}" (${match.listUuid})`);
  return listUuid;
}

export async function addItemsToBring(
  items: Array<{ name: string; specification?: string | null }>
): Promise<void> {
  const uuid = await getTargetListUuid();
  await callTool("saveItemBatch", {
    listUuid: uuid,
    items: items.map((i) => ({
      itemName: i.name,
      ...(i.specification ? { specification: i.specification } : {}),
    })),
  });
}

export async function addIngredientsToBring(ingredients: Ingredient[]): Promise<void> {
  await addItemsToBring(ingredients);
}
