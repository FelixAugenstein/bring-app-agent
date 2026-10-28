import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RECIPES_DIR = resolve(__dirname, "../../recipes");

export interface Ingredient {
  name: string;
  specification: string | null;
}

export interface Recipe {
  slug: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  /** Markdown text after the front-matter (cooking instructions) */
  body: string;
}

function parseIngredients(
  ingredients: string[],
  details: Record<string, string> = {}
): Ingredient[] {
  return ingredients.map((raw) => {
    // If there's an explicit detail entry for this ingredient, use it as spec
    if (details[raw]) {
      return { name: raw, specification: details[raw] };
    }
    // Otherwise try to split "400g Spaghetti" or "2 Äpfel" etc.
    const match = raw.match(/^([\d,./]+\s*(?:g|kg|ml|l|EL|TL|Stück|Dose[n]?|Bund|Zweige?|Zehe[n]?|Prise|Scheibe[n]?)?\s*)/i);
    if (match && match[1].trim()) {
      const spec = match[1].trim();
      const name = raw.slice(match[1].length).trim();
      return { name: name || raw, specification: spec };
    }
    return { name: raw, specification: null };
  });
}

/** Reads all recipes from disk. Called per request, so new/edited .md files show up without a restart. */
export function loadRecipes(): Recipe[] {
  const files = readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).sort();
  const recipes: Recipe[] = [];
  for (const file of files) {
    try {
      const { data, content } = matter(readFileSync(join(RECIPES_DIR, file), "utf8"));
      const slug = file.replace(/\.md$/, "");
      recipes.push({
        slug,
        title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : slug,
        servings: (data.servings as number) ?? 2,
        ingredients: parseIngredients(
          (data.ingredients as string[]) ?? [],
          (data.ingredientDetails as Record<string, string>) ?? {}
        ),
        body: content.trim(),
      });
    } catch (err) {
      console.error(`⚠️ Could not parse recipe ${file}:`, err);
    }
  }
  return recipes;
}

export function getRecipeByTitle(recipes: Recipe[], title: string): Recipe | undefined {
  return recipes.find(
    (r) => r.title.toLowerCase() === title.toLowerCase()
  );
}
