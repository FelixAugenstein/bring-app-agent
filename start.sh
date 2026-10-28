#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🍳 Bring! AI Agent - Starting all services..."
echo ""

# Check Ollama
if ! command -v ollama &>/dev/null; then
  echo "❌  Ollama not found. Install from https://ollama.com"
  exit 1
fi

# Refuse to start if a previous instance still holds our ports
# (otherwise the OLD server keeps answering and the new code never runs)
for PORT in 3001 5173; do
  if lsof -nP -iTCP:$PORT -sTCP:LISTEN &>/dev/null; then
    echo "❌  Port $PORT is already in use:"
    lsof -nP -iTCP:$PORT -sTCP:LISTEN
    echo "    Stop it first:  lsof -ti :$PORT | xargs kill"
    exit 1
  fi
done

# Check model
if ! ollama list 2>/dev/null | grep -q "qwen3.5:4b"; then
  echo "📥  Pulling qwen3.5:4b (first time only)..."
  ollama pull qwen3.5:4b
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "🤖  Starting Ollama..."
  ollama serve &
  sleep 3
else
  echo "✅  Ollama already running"
fi

# Start backend (its logs appear in this terminal, prefixed with [backend])
echo "🚀  Starting agent backend (port 3001)..."
cd "$SCRIPT_DIR/server"
npm run dev 2>&1 | sed -u 's/^/[backend]  /' &

# Start frontend
echo "🌐  Starting Vue frontend (port 5173)..."
cd "$SCRIPT_DIR/frontend"
npm run dev 2>&1 | sed -u 's/^/[frontend] /' &

# Wait until both servers answer
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:3001/recipes && curl -s -o /dev/null http://localhost:5173; then
    READY=1
    break
  fi
  sleep 1
done

echo ""
if [ -z "$READY" ]; then
  echo "⚠️   Servers did not answer within 30s - check the [backend]/[frontend] output above."
else
  echo "✅  All services started!"
fi
echo ""
echo "   Frontend (open this): http://localhost:5173"
echo "   Backend API:          http://localhost:3001  (e.g. http://localhost:3001/recipes)"
echo "   Ollama:               http://localhost:11434"
echo ""
echo "👀  Watching what happens:"
echo "   - Backend logs appear right here, prefixed with [backend]:"
echo "       💬 incoming chat message + total reply time"
echo "       🧠 Ollama call (model load time, tokens, raw answer)"
echo "       🔧 Bring! MCP calls and how long they take"
echo "   - Which model is loaded / on GPU (new terminal):  ollama ps"
echo "   - Ollama's own server log (new terminal):         tail -f ~/.ollama/logs/server.log"
echo ""
echo "Press Ctrl+C to stop all services."

# Cleanup on exit
# (kill 0 signals the whole process group, so npm's child processes — tsx/vite — stop too)
trap 'echo ""; echo "Stopping..."; trap - INT TERM; kill 0; exit 0' INT TERM

wait
