import Ollama from "ollama";
import type { Message as OllamaMessage, Tool, ToolCall } from "ollama";
import type { Recipe } from "./recipeLoader.js";
import { addIngredientsToBring, addItemsToBring, getListName } from "./bringClient.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Week-planner state per session
export interface PlannerState {
  pending: Recipe[] | null; // proposed recipes awaiting confirmation
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — this is what tells the LLM how to behave.
// Edit the text below to change the agent's behaviour.
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(recipes: Recipe[], pending: Recipe[] | null): string {
  const recipeList = recipes.map((r) => `- ${r.title}`).join("\n");
  const pendingBlock = pending
    ? `\nAKTUELLER WOCHENPLAN-VORSCHLAG (wartet auf Bestätigung des Benutzers):\n${pending
        .map((r) => `- ${r.title}`)
        .join("\n")}\n`
    : "";

  return `Du bist ein freundlicher Küchenassistent. Du pflegst die Bring!-Einkaufsliste "${getListName()}" des Benutzers. Du führst Aktionen IMMER über die bereitgestellten Werkzeuge (Tools) aus – schreibe nie nur, dass du etwas getan hast.

Verfügbare Rezepte (NUR diese existieren – erfinde KEINE Rezepte und KEINE Zutaten):
${recipeList}
${pendingBlock}
Was du tun kannst:
1. Wochenplan: Der Benutzer möchte z.B. "plane meine Woche" oder "wähle 5 Rezepte für diese Woche".
   -> Rufe propose_week_plan auf. Setze "count" auf die gewünschte Anzahl (Standard 7).
   Nennt der Benutzer KEINE bestimmten Rezepte, lass "recipes" leer – dann wählt das System zufällig.
   Füge NOCH NICHTS zur Liste hinzu. Der Benutzer muss den Vorschlag zuerst bestätigen.
2. Wenn ein Wochenplan-Vorschlag wartet:
   - Benutzer ist einverstanden ("ja", "passt", "bestätigt", "ok") -> confirm_week_plan
   - Benutzer will ein Rezept tauschen -> swap_recipe_in_plan
   - Benutzer lehnt ab / bricht ab -> cancel_week_plan
3. Ein einzelnes Rezept: "Füge die Zutaten für Pfannkuchen hinzu" -> add_recipe_to_list mit dem exakten Rezeptnamen. Du darfst KEINE Zutaten selbst auflisten oder einzeln hinzufügen; das System kennt die Zutaten des Rezepts.
4. Einzelne Artikel: "2 Äpfel und 3 Bananen" -> add_items_to_list mit EINEM Aufruf und allen Artikeln, z.B. items=[{"name":"Äpfel","specification":"2"},{"name":"Bananen","specification":"3"}]. "name" ist nur der Artikel, "specification" die Menge (kann weggelassen werden).
5. Für alles andere (Fragen, Smalltalk, Rezeptideen aus der Liste) antworte kurz im Text ohne Tool.

Antworte in der Sprache, in der der Benutzer schreibt (Deutsch oder Englisch). Halte Antworten kurz.`;
}

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "propose_week_plan",
      description:
        "Schlägt einen Wochenplan mit Rezepten vor und wartet auf Bestätigung. Fügt noch nichts zur Einkaufsliste hinzu.",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Anzahl der Rezepte (Standard 7)" },
          recipes: {
            type: "array",
            items: { type: "string" },
            description: "Nur falls der Benutzer bestimmte Rezepte nennt: exakte Rezeptnamen. Sonst leer lassen.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_week_plan",
      description: "Der Benutzer hat den vorgeschlagenen Wochenplan bestätigt: alle Zutaten aller Rezepte zur Bring!-Liste hinzufügen.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "swap_recipe_in_plan",
      description: "Ersetzt ein Rezept im wartenden Wochenplan-Vorschlag durch ein anderes.",
      parameters: {
        type: "object",
        required: ["from", "to"],
        properties: {
          from: { type: "string", description: "Rezept, das entfernt wird" },
          to: { type: "string", description: "Rezept, das stattdessen aufgenommen wird" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_week_plan",
      description: "Verwirft den wartenden Wochenplan-Vorschlag.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_recipe_to_list",
      description: "Fügt alle Zutaten eines einzelnen Rezepts zur Bring!-Liste hinzu.",
      parameters: {
        type: "object",
        required: ["recipe"],
        properties: { recipe: { type: "string", description: "Exakter Rezeptname aus der Rezeptliste" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_items_to_list",
      description: "Fügt einen oder mehrere einzelne Artikel zur Bring!-Liste hinzu.",
      parameters: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", description: "Artikelname, z.B. Äpfel" },
                specification: { type: "string", description: "Menge/Detail, z.B. 2 oder 500g" },
              },
            },
          },
        },
      },
    },
  },
];

function findRecipe(recipes: Recipe[], name: unknown): Recipe | undefined {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return undefined;
  return (
    recipes.find((r) => r.title.toLowerCase() === n) ??
    recipes.find((r) => r.title.toLowerCase().includes(n) || n.includes(r.title.toLowerCase()))
  );
}

function parseArgs(call: ToolCall): Record<string, any> {
  const raw = call.function.arguments as unknown;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return (raw as Record<string, any>) ?? {};
}

function bulletList(recipes: Recipe[]): string {
  return recipes.map((r) => `- ${r.title}`).join("\n");
}

/** Executes one tool call chosen by the LLM. Returns the text shown to the user. */
async function runTool(
  call: ToolCall,
  recipes: Recipe[],
  state: PlannerState
): Promise<string> {
  const name = call.function.name;
  const args = parseArgs(call);

  switch (name) {
    case "propose_week_plan": {
      const count = Math.min(Math.max(Math.round(Number(args.count) || 7), 1), recipes.length);
      const requested: unknown[] = Array.isArray(args.recipes) ? args.recipes : [];
      const chosen: Recipe[] = [];
      for (const n of requested) {
        const r = findRecipe(recipes, n);
        if (r && !chosen.includes(r)) chosen.push(r);
      }
      chosen.splice(count); // never more than requested
      // Top up randomly (this is the "random" part of the week planner)
      const remaining = recipes.filter((r) => !chosen.includes(r));
      while (chosen.length < count && remaining.length > 0) {
        chosen.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]);
      }
      state.pending = chosen;
      return `Hier ist dein Wochenplan mit ${chosen.length} Rezepten:\n${bulletList(chosen)}\n\nPasst das so? Dann bestätige – oder sag mir, welches Rezept ich tauschen soll.`;
    }

    case "confirm_week_plan": {
      if (!state.pending) return "⚠️ Es gibt gerade keinen Wochenplan-Vorschlag zum Bestätigen.";
      const plan = state.pending;
      for (const r of plan) await addIngredientsToBring(r.ingredients);
      state.pending = null;
      return `✅ Alle Zutaten für diese Rezepte wurden zu „${getListName()}" hinzugefügt:\n${bulletList(plan)}`;
    }

    case "swap_recipe_in_plan": {
      if (!state.pending) return "⚠️ Es gibt gerade keinen Wochenplan-Vorschlag, in dem ich etwas tauschen könnte.";
      const from = findRecipe(state.pending, args.from);
      const to = findRecipe(recipes, args.to);
      if (!from) return `⚠️ „${args.from}" ist nicht im aktuellen Vorschlag.`;
      if (!to) return `⚠️ Ein Rezept „${args.to}" habe ich nicht.`;
      if (state.pending.includes(to)) return `⚠️ „${to.title}" ist schon im Vorschlag.`;
      state.pending = state.pending.map((r) => (r === from ? to : r));
      return `Getauscht: ${from.title} → ${to.title}\n\nAktualisierter Wochenplan:\n${bulletList(state.pending)}\n\nPasst das so?`;
    }

    case "cancel_week_plan": {
      state.pending = null;
      return "Ok, der Wochenplan wurde verworfen. Es wurde nichts zur Liste hinzugefügt.";
    }

    case "add_recipe_to_list": {
      const r = findRecipe(recipes, args.recipe);
      if (!r) return `⚠️ Ein Rezept „${args.recipe}" habe ich nicht.`;
      await addIngredientsToBring(r.ingredients);
      const items = r.ingredients.map((i) => (i.specification ? `${i.name} (${i.specification})` : i.name));
      return `✅ Zutaten für „${r.title}" wurden zu „${getListName()}" hinzugefügt:\n${items.map((i) => `- ${i}`).join("\n")}`;
    }

    case "add_items_to_list": {
      const raw: any[] = Array.isArray(args.items) ? args.items : [];
      const items = raw
        .map((i) => ({
          name: String(i?.name ?? "").trim(),
          specification: i?.specification ? String(i.specification).trim() : null,
        }))
        .filter((i) => i.name);
      if (items.length === 0) return "⚠️ Ich konnte keine Artikel erkennen.";
      await addItemsToBring(items);
      const lines = items.map((i) => `- ${i.specification ? `${i.specification} ` : ""}${i.name}`);
      return `✅ Zu „${getListName()}" hinzugefügt:\n${lines.join("\n")}`;
    }

    default:
      return `⚠️ Unbekanntes Werkzeug „${name}".`;
  }
}

export async function chat(
  userMessage: string,
  history: Message[],
  recipes: Recipe[],
  plannerState: PlannerState
): Promise<{ reply: string; updatedHistory: Message[]; plannerState: PlannerState }> {
  const state: PlannerState = { pending: plannerState.pending };

  const messages: OllamaMessage[] = [
    { role: "system", content: buildSystemPrompt(recipes, state.pending) },
    ...history,
    { role: "user", content: userMessage },
  ];

  const model = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
  console.log(`🧠 Ollama (${model}) thinking... (${messages.length} messages in prompt)`);
  const t0 = Date.now();
  const response = await Ollama.chat({
    model,
    messages,
    tools,
    think: false, // skip qwen3's reasoning phase — much faster on an M1
  });

  const toolCalls = response.message.tool_calls ?? [];
  console.log(
    `🧠 Ollama answered in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
      `(load ${((response.load_duration ?? 0) / 1e9).toFixed(1)}s, ${response.eval_count ?? "?"} tokens): ` +
      (toolCalls.length
        ? toolCalls.map((c) => `${c.function.name}(${JSON.stringify(parseArgs(c))})`).join(", ")
        : response.message.content.replace(/\s+/g, " ").slice(0, 200))
  );

  let reply: string;
  if (toolCalls.length > 0) {
    // The LLM chose the actions; the server executes them and reports the real result
    // (the LLM's own free text is dropped so it can't claim things that did not happen).
    const results: string[] = [];
    for (const call of toolCalls) {
      try {
        results.push(await runTool(call, recipes, state));
      } catch (err) {
        console.error(`Tool ${call.function.name} failed:`, err);
        results.push(`⚠️ ${call.function.name} ist fehlgeschlagen: ${String(err)}`);
      }
    }
    reply = results.join("\n\n");
  } else {
    reply = response.message.content.trim() || "Dazu habe ich leider keine Antwort.";
  }

  const updatedHistory: Message[] = [
    ...history,
    { role: "user", content: userMessage },
    { role: "assistant", content: reply },
  ];

  // Keep history to last 20 messages to avoid huge prompts
  return { reply, updatedHistory: updatedHistory.slice(-20), plannerState: state };
}
