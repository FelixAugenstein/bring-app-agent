# Bring! AI Agent — Implementation Plan

## Overview

Build a local AI agent that reads Markdown recipe files and adds groceries to a Bring! shopping list on demand. A Vue 3 chat frontend lets you talk to the agent in natural language — e.g. "Plan my week of food" — and the agent will pick 7 recipes at random, confirm with you, then batch-add all ingredients to Bring!.

**Stack:**
- **MCP server:** [florianwittkamp/bring-mcp](https://github.com/florianwittkamp/bring-mcp) (npx, STDIO)
- **Local LLM:** Ollama with `qwen3.5:4b` (3.4 GB, runs 82% on M1 GPU, ~10 tok/s) — native tool-calling support, Apache 2.0 licence
- **Agent runtime:** Node.js / TypeScript thin server that talks to the LLM + invokes MCP tools
- **Recipes:** plain Markdown files in `/recipes` in **German** — **agent is strictly limited to these files, no hallucinated recipes**
- **Language:** recipes are in German; user will mostly chat in German; ingredients are passed through **as-is** to Bring! — no translation needed. Bring! `saveItem` supports an optional `specification` field for quantity/detail (e.g. item `"Apfel"`, specification `"1"`).
- **Frontend:** Vue 3 + Vite (simple chat UI)

> **On Claude:** There are no open-source Claude models available in Ollama — Claude is proprietary (Anthropic). `qwen3.5:4b` is the best fit for M1 8 GB: native tool-calling, fits fully in GPU memory, fast enough for chat. If you have 16 GB RAM you could go up to `qwen3.5:9b` for better reasoning quality.

---

## Sub-Tasks

---

### 1 — Smoke-test the Bring! MCP

**Intent:** Verify the MCP server can reach your real Bring! list before building anything else. Fail fast here.

**Expected Outcomes:**
- `npx bring-mcp@latest` starts without error
- A call to `saveItem` with "Apples" appears on your live Bring! list

**Todo List:**
1. Create a `.env` file inside `bring-app/` with `BRING_EMAIL` and `BRING_PASSWORD`
2. Run the MCP server locally via `npx -y bring-mcp@latest` and test with MCP Inspector (`npx @modelcontextprotocol/inspector`)
3. Call `saveItem` with item `"Apples"` on your default list and confirm it shows up in the Bring! app
4. Call `removeItem` to clean up the test entry

**Relevant Context:** bring-mcp README — tools `getDefaultList`, `saveItem`, `removeItem`

**Implementation note:** Implemented as `test-mcp.mjs` (MCP SDK client) instead of MCP Inspector. `getDefaultList` returns `{ listUuid, source }`; `removeItem` takes `itemId` (= item name).

**Status:** [x] done

---

### 2 — Recipe Markdown structure + sample recipes

**Intent:** Define a simple, machine-readable recipe format and add 7–10 starter recipes the agent can work with immediately.

**Expected Outcomes:**
- A `/recipes` folder exists with at least 7 `.md` files
- Each file has a consistent YAML front-matter with a `title` and an `ingredients` list

**Todo List:**
1. Decide on the schema (front-matter example below)
2. Create `recipes/` directory inside `bring-app/`
3. Write 7–10 recipe Markdown files in **German** (title, ingredients, and instructions all in German)

**Recipe front-matter schema (as implemented):**
```yaml
---
title: Spaghetti Bolognese
servings: 4
ingredients:        # item names -> Bring! `itemName`
  - Spaghetti
  - Rinderhackfleisch
  - Dosentomaten
ingredientDetails:  # optional amounts -> Bring! `specification`
  Spaghetti: "400g"
  Rinderhackfleisch: "500g"
  Dosentomaten: "2 Dosen"
---
```
(Freie Kochanleitung folgt nach dem Front-matter — auf Deutsch.)

**Status:** [x] done (9 recipes in `recipes/`; `recipeLoader.ts` also falls back to splitting "400g Spaghetti"-style strings)

---

### 3 — Agent backend (Node / TypeScript)

**Intent:** A lightweight HTTP server that (a) loads recipes, (b) talks to Ollama, and (c) calls the Bring! MCP tools. This is the brain of the whole app.

**Expected Outcomes:**
- `POST /chat` accepts a message and returns an agent reply
- The agent can answer "add pasta ingredients to my list" and actually call `saveItem`
- The agent can randomly pick 7 recipes, list them, and await user confirmation before adding anything

**Todo List:**
1. Scaffold a `server/` package (`npm init`, TypeScript, `tsx` for dev)
2. Add dependencies: `ollama` npm package, `@modelcontextprotocol/sdk` client, `gray-matter` (parse YAML front-matter), `express` or `fastify`
3. Implement recipe loader — reads all `.md` files in `../recipes`, parses front-matter; for each ingredient split the raw string into `name` (the food item, e.g. `"Apfel"`) and `specification` (amount/detail, e.g. `"1"` or `"400g"`) — both passed straight to `saveItem`
4. Implement MCP client — spawns `npx bring-mcp@latest` as a child process and wraps `saveItemBatch` / `getDefaultList` calls
5. Implement the Ollama chat loop — system prompt tells the model: (a) available recipes, (b) MCP tools, (c) reply in the same language the user writes in; ingredients are passed through verbatim — no translation, no normalisation
6. Implement the week-planner flow: agent picks 7 random recipes → sends titles to frontend for confirmation → on confirm calls `saveItemBatch` for each recipe's list ID
7. Expose `GET /recipes` so the frontend can list recipe titles

**Status:** [x] done

---

### 4 — Vue 3 chat frontend

**Intent:** A simple, clean chat UI where you type messages and see agent replies. No complex routing needed.

**Expected Outcomes:**
- `npm run dev` starts the Vue app on `localhost:5173`
- You can type a message, submit, and see streaming or polled replies
- A "Recipes" sidebar shows available recipes with a one-click "add to list" shortcut

**Todo List:**
1. Scaffold with `npm create vue@latest` (Vite, TypeScript, no SSR)
2. Create a `ChatView` component — message thread + input box
3. Wire `POST /chat` to the backend; stream or poll for responses
4. Add a `RecipeSidebar` component that fetches `GET /recipes` and renders titles with an "Add to Bring!" button
5. Basic styling (Carbon, Tailwind, or plain CSS — keep it simple)

**Status:** [x] done

---

### 5 — Week planner flow (end-to-end)

> **Implementation note:** The state machine is simplified to `pending: Recipe[] | null` in `agent.ts` (idle = `null`, proposing/confirming = set). The LLM drives everything via Ollama tool calling (`propose_week_plan`, `confirm_week_plan`, `swap_recipe_in_plan`, `cancel_week_plan`, `add_recipe_to_list`, `add_items_to_list`); the server executes the chosen tool and reports the real result. The target list is resolved by name (`BRING_LIST_NAME`, default "Einkauf Supermarkt") via `loadLists`. If the LLM returns fewer than 7 valid recipes the server tops up randomly. Ingredients are sent per recipe with `saveItemBatch` (one call per recipe).

**Intent:** The signature feature — user asks to "plan my week", agent picks 7 random recipes, confirms, then bulk-adds all ingredients.

**Expected Outcomes:**
- Typing "Plan my week of food" triggers a random 7-recipe selection
- Agent lists the recipes and asks for confirmation in the chat
- User can ask to swap a recipe ("replace pasta with something else")
- On final "yes / confirm", all ingredients land in the Bring! list

**Todo List:**
1. Add a `weekPlanner` state machine in the agent backend (states: `idle → proposing → confirming → done`)
2. System prompt instructs the LLM to output structured JSON proposals (recipe list) that the server intercepts
3. Parse LLM output for recipe names; look up ingredients from loaded recipes
4. Send confirmation prompt back to the frontend with the recipe list rendered as a card/list
5. On user confirmation, call `saveItemBatch` for all collected ingredients in one or two batched MCP calls
6. Emit a "Done! X items added to Bring!" summary message

**Status:** [x] done

---

### 6 — Local dev setup + README

**Intent:** Anyone (including future-you) can clone and run everything with minimal steps.

**Expected Outcomes:**
- A root `README.md` explains how to start Ollama, configure `.env`, and run both server and frontend
- A single `docker-compose.yml` or `start.sh` script launches everything in one command

**Todo List:**
1. Write `bring-app/README.md` with setup instructions and prerequisite list (Node 22+, Ollama, Bring! account)
2. Add a `.env.example` file
3. Optional: add a `start.sh` that runs `ollama serve`, `npm run dev` in server/, and `npm run dev` in frontend/ concurrently

**Status:** [x] done

---

## Decision Log

| Decision | Choice | Reason |
|---|---|---|
| LLM runtime | Ollama (local) | No API keys, runs offline |
| LLM model | `qwen3.5:4b` | Native tool-calling, 3.4 GB, runs fully on M1 GPU, Apache 2.0 |
| Frontend | Vue 3 + Vite | User-preferred, minimal setup |
| Agent protocol | Thin Node server calling MCP via child process | Keeps it simple; no orchestration framework needed |
| Recipe format | Markdown + YAML front-matter | Human-readable and trivially parseable |
| Recipe scope | Strictly from Markdown files only | System prompt forbids unknown recipes; week planner samples from loaded file list |
| Recipe language | German | All recipe files authored in German; ingredients passed to Bring! verbatim |
| UI language | Mostly German, EN also works | LLM replies in the language used; no translation layer needed |
| Bring! item format | item + specification | e.g. item="Apfel" spec="1", item="Spaghetti" spec="400g" — maps directly to saveItem API |
| Recipe loading | Re-read `recipes/` on every request | `tsx watch` does not watch the recipes folder; new `.md` files show up in the sidebar and for the agent without a restart |
| Recipe detail view | `GET /recipes/:slug` + modal in `RecipeSidebar.vue` | Clicking a recipe shows ingredients with amounts and the Markdown instructions (rendered as plain text, no `v-html`) |

