import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadRecipes } from "./recipeLoader.js";
import { chat } from "./agent.js";
import type { Message, PlannerState } from "./agent.js";

// Load .env from bring-app root
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const app = express();
app.use(cors());
app.use(express.json());

const initial = loadRecipes();
console.log(`📚 Loaded ${initial.length} recipes: ${initial.map((r) => r.title).join(", ")}`);

// Per-session state: keyed by a simple session id the frontend sends
const sessions = new Map<string, { history: Message[]; plannerState: PlannerState }>();

function getSession(id: string) {
  if (!sessions.has(id)) {
    sessions.set(id, { history: [], plannerState: { pending: null } });
  }
  return sessions.get(id)!;
}

// GET /recipes — list all available recipes (re-read from disk every time)
app.get("/recipes", (_req, res) => {
  res.json(loadRecipes().map((r) => ({ slug: r.slug, title: r.title, servings: r.servings })));
});

// GET /recipes/:slug — full recipe incl. ingredients and cooking instructions
app.get("/recipes/:slug", (req, res) => {
  const recipe = loadRecipes().find((r) => r.slug === req.params.slug);
  if (!recipe) {
    res.status(404).json({ error: "recipe not found" });
    return;
  }
  res.json({
    slug: recipe.slug,
    title: recipe.title,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    instructions: recipe.body,
  });
});

// POST /chat — send a message to the agent
app.post("/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body as { message: string; sessionId?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const session = getSession(sessionId);
  console.log(`💬 [${sessionId}] user: ${message}`);
  const t0 = Date.now();

  try {
    const result = await chat(message, session.history, loadRecipes(), session.plannerState);
    session.history = result.updatedHistory;
    session.plannerState = result.plannerState;
    console.log(`💬 [${sessionId}] reply in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${result.reply.replace(/\n/g, " | ").slice(0, 200)}`);
    res.json({ reply: result.reply });
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /reset — clear session history
app.post("/reset", (req, res) => {
  const { sessionId = "default" } = req.body as { sessionId?: string };
  sessions.delete(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`🚀 Bring! agent server running on http://localhost:${PORT}`);
});
