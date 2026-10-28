<script setup lang="ts">
import { ref, computed } from "vue";

defineProps<{
  recipes: { slug: string; title: string; servings: number }[];
}>();

const emit = defineEmits<{
  (e: "add-recipe", message: string): void;
  (e: "refresh"): void;
}>();

interface RecipeDetail {
  slug: string;
  title: string;
  servings: number;
  ingredients: { name: string; specification: string }[];
  instructions: string;
}

const detail = ref<RecipeDetail | null>(null);
const detailError = ref("");
const detailLoading = ref(false);

// Instructions are plain Markdown; render as text lines (no v-html) to stay safe.
const instructionLines = computed(() =>
  (detail.value?.instructions ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) =>
      l.startsWith("#")
        ? { heading: true, text: l.replace(/^#+\s*/, "") }
        : { heading: false, text: l }
    )
);

function addRecipe(title: string) {
  emit("add-recipe", `Füge die Zutaten für ${title} zu meiner Bring!-Liste hinzu`);
}

async function openRecipe(slug: string) {
  detail.value = null;
  detailError.value = "";
  detailLoading.value = true;
  try {
    const res = await fetch(`/recipes/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    detail.value = await res.json();
  } catch (e) {
    detailError.value = "Rezept konnte nicht geladen werden.";
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  detail.value = null;
  detailError.value = "";
  detailLoading.value = false;
}

function addFromDetail() {
  if (!detail.value) return;
  addRecipe(detail.value.title);
  closeDetail();
}
</script>

<template>
  <div class="sidebar-inner">
    <div class="sidebar-header">
      <span>📖 Meine Rezepte</span>
      <button class="refresh-btn" @click="emit('refresh')" title="Rezepte neu laden">↻</button>
    </div>
    <p v-if="!recipes.length" class="no-recipes">Keine Rezepte gefunden.</p>
    <ul v-else class="recipe-list">
      <li v-for="r in recipes" :key="r.slug" class="recipe-item" @click="openRecipe(r.slug)">
        <span class="recipe-title">{{ r.title }}</span>
        <span class="recipe-servings">{{ r.servings }} Port.</span>
        <button
          class="add-btn"
          @click.stop="addRecipe(r.title)"
          title="Zutaten zur Bring!-Liste hinzufügen"
        >
          🛒
        </button>
      </li>
    </ul>
    <div class="sidebar-hint">
      <strong>Tipp:</strong> Klicke auf ein Rezept für Details. Schreibe „Plane meine Woche" um
      7 Rezepte automatisch auszuwählen.
    </div>

    <div v-if="detailLoading || detail || detailError" class="modal-backdrop" @click.self="closeDetail">
      <div class="modal" role="dialog" aria-modal="true">
        <button class="close-btn" @click="closeDetail" title="Schließen">✕</button>
        <p v-if="detailLoading" class="modal-status">Lade Rezept…</p>
        <p v-else-if="detailError" class="modal-status">{{ detailError }}</p>
        <template v-else-if="detail">
          <h2>{{ detail.title }}</h2>
          <p class="modal-servings">{{ detail.servings }} Portionen</p>

          <h3>Zutaten</h3>
          <ul class="ingredients">
            <li v-for="ing in detail.ingredients" :key="ing.name">
              <span class="ing-amount">{{ ing.specification }}</span>
              <span>{{ ing.name }}</span>
            </li>
          </ul>

          <template v-for="(line, i) in instructionLines" :key="i">
            <h3 v-if="line.heading">{{ line.text }}</h3>
            <p v-else class="step">{{ line.text }}</p>
          </template>

          <button class="modal-add" @click="addFromDetail">🛒 Zur Bring!-Liste hinzufügen</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  padding: 16px 16px 10px;
  border-bottom: 1px solid #f3f4f6;
}

.refresh-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: #6b7280;
  border-radius: 4px;
  padding: 0 4px;
}
.refresh-btn:hover { background: #f3f4f6; }

.no-recipes {
  padding: 16px;
  color: #9ca3af;
  font-size: 0.85rem;
}

.recipe-list {
  list-style: none;
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.recipe-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  margin: 2px 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.recipe-item:hover { background: #f9fafb; }
.recipe-item:hover .recipe-title { color: #2563eb; }

.recipe-title {
  flex: 1;
  font-size: 0.88rem;
  line-height: 1.3;
}

.recipe-servings {
  font-size: 0.75rem;
  color: #9ca3af;
  white-space: nowrap;
}

.add-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
}
.add-btn:hover { opacity: 1; background: #f0fdf4; }

.sidebar-hint {
  padding: 12px 14px;
  font-size: 0.78rem;
  color: #6b7280;
  border-top: 1px solid #f3f4f6;
  line-height: 1.4;
}

/* ── Recipe detail modal ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  position: relative;
  background: #fff;
  border-radius: 12px;
  width: min(560px, 92vw);
  max-height: 85vh;
  overflow-y: auto;
  padding: 24px 28px;
}

.modal h2 { font-size: 1.3rem; margin-bottom: 2px; }
.modal h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin: 18px 0 8px;
}
.modal-servings { color: #9ca3af; font-size: 0.85rem; }
.modal-status { padding: 12px 0; color: #6b7280; }

.close-btn {
  position: absolute;
  top: 12px;
  right: 14px;
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: #6b7280;
}

.ingredients { list-style: none; }
.ingredients li {
  display: flex;
  gap: 10px;
  padding: 3px 0;
  font-size: 0.92rem;
}
.ing-amount {
  min-width: 90px;
  color: #6b7280;
}

.step {
  font-size: 0.92rem;
  line-height: 1.5;
  padding: 3px 0;
}

.modal-add {
  margin-top: 20px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.modal-add:hover { background: #2563eb; }
</style>
