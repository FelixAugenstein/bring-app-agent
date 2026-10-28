<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import RecipeSidebar from "./components/RecipeSidebar.vue";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Recipe {
  slug: string;
  title: string;
  servings: number;
}

const messages = ref<ChatMessage[]>([
  {
    role: "assistant",
    content:
      "Hallo! Ich bin dein Kuechen-Assistent. Ich kann dir helfen, Zutaten zu deiner Bring!-Liste hinzuzufuegen oder deinen Wochenplan zu erstellen. Probiere z.B.: 'Plane meine Woche' oder 'Fuege Zutaten fuer Spaghetti Bolognese hinzu'.",
  },
]);

const input = ref("");
const loading = ref(false);
const recipes = ref<Recipe[]>([]);
const sessionId = Math.random().toString(36).slice(2);
const chatEnd = ref<HTMLDivElement | null>(null);

async function fetchRecipes() {
  try {
    const res = await fetch("/recipes");
    recipes.value = await res.json();
  } catch (e) {
    console.error("Could not load recipes", e);
  }
}

async function scrollToBottom() {
  await nextTick();
  chatEnd.value?.scrollIntoView({ behavior: "smooth" });
}

async function sendMessage(text?: string) {
  const msg = (text ?? input.value).trim();
  if (!msg || loading.value) return;
  input.value = "";

  messages.value.push({ role: "user", content: msg });
  loading.value = true;
  await scrollToBottom();

  try {
    const res = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, sessionId }),
    });
    const data = await res.json();
    messages.value.push({
      role: "assistant",
      content: data.reply ?? data.error ?? "Unbekannter Fehler",
    });
  } catch (e) {
    messages.value.push({
      role: "assistant",
      content: "Verbindung zum Server fehlgeschlagen. Laeuft der Server?",
    });
  } finally {
    loading.value = false;
    await scrollToBottom();
  }
}

async function resetChat() {
  await fetch("/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  messages.value = [
    {
      role: "assistant",
      content: "Chat zurueckgesetzt. Wie kann ich dir helfen?",
    },
  ];
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function formatMessage(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

onMounted(() => {
  fetchRecipes();
  // Pick up newly added recipe files when returning to the tab
  window.addEventListener("focus", fetchRecipes);
});
onUnmounted(() => window.removeEventListener("focus", fetchRecipes));
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <RecipeSidebar :recipes="recipes" @add-recipe="sendMessage" @refresh="fetchRecipes" />
    </aside>

    <main class="chat">
      <header class="chat-header">
        <span class="chat-title">🛒 Bring! Assistent</span>
        <button class="reset-btn" @click="resetChat">↺ Neu</button>
      </header>

      <div class="messages">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['message', msg.role]"
        >
          <span class="bubble" v-html="formatMessage(msg.content)"></span>
        </div>
        <div v-if="loading" class="message assistant">
          <span class="bubble typing">
            <span></span><span></span><span></span>
          </span>
        </div>
        <div ref="chatEnd" />
      </div>

      <form class="input-area" @submit.prevent="sendMessage()">
        <textarea
          v-model="input"
          rows="2"
          placeholder="Schreib eine Nachricht… (Enter zum Senden)"
          @keydown="handleKeydown"
        />
        <button type="submit" :disabled="loading || !input.trim()">
          Senden
        </button>
      </form>
    </main>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  background: #f0f2f5;
  color: #1a1a1a;
  height: 100vh;
  overflow: hidden;
}

#app { height: 100vh; }

.app {
  display: flex;
  height: 100vh;
}

/* ── Sidebar ── */
.sidebar {
  width: 260px;
  min-width: 220px;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
  flex-shrink: 0;
}

/* ── Chat ── */
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.chat-title { font-weight: 600; font-size: 1rem; }

.reset-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  color: #6b7280;
}
.reset-btn:hover { background: #f3f4f6; }

/* ── Messages ── */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  display: flex;
}
.message.user { justify-content: flex-end; }
.message.assistant { justify-content: flex-start; }

.bubble {
  max-width: 75%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 0.92rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.message.user .bubble {
  background: #3b82f6;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message.assistant .bubble {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}

/* Typing indicator */
.typing { display: flex; gap: 5px; align-items: center; padding: 12px 16px; }
.typing span {
  width: 7px; height: 7px;
  background: #9ca3af;
  border-radius: 50%;
  animation: bounce 1.2s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}

/* ── Input ── */
.input-area {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  background: #fff;
  border-top: 1px solid #e5e7eb;
}

.input-area textarea {
  flex: 1;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.input-area textarea:focus { border-color: #3b82f6; }

.input-area button {
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0 20px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.input-area button:hover:not(:disabled) { background: #2563eb; }
.input-area button:disabled { background: #93c5fd; cursor: default; }
</style>
