#!/bin/bash
# Weaver — Start all services
# Run from the weaver/ root directory

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🧵 Starting Weaver..."
echo ""

# 1. Python service
echo "▶ Starting Python FastAPI service (port 8000)..."
cd "$ROOT/python-service"
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
PYTHON_PID=$!
echo "  PID: $PYTHON_PID"

sleep 2

# 2. Node.js relay
echo "▶ Starting Node.js relay server (port 1234)..."
cd "$ROOT/backend"
node server.js &
NODE_PID=$!
echo "  PID: $NODE_PID"

sleep 1

# 3. Frontend dev server
echo "▶ Starting Vite frontend (port 5173)..."
cd "$ROOT"
npm run dev &
VITE_PID=$!
echo "  PID: $VITE_PID"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧵 Weaver is running!"
echo ""
echo "  Frontend:        http://localhost:5173"
echo "  Backend relay:   ws://localhost:1234"
echo "  Python service:  http://localhost:8000/docs"
echo ""
echo "  Real-time collaboration:"
echo "    1. Open http://localhost:5173 in Window 1 → New Workspace"
echo "    2. Copy the Workspace ID"
echo "    3. Open http://localhost:5173 in Window 2 → Join Workspace"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all services."

# Cleanup on exit
trap "echo ''; echo 'Stopping…'; kill $PYTHON_PID $NODE_PID $VITE_PID 2>/dev/null; exit" SIGINT SIGTERM

wait
