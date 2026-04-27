#!/bin/bash
# Angol Tanulás WebApp – indítószkript (Pop!_OS / Ubuntu)
# Használat: bash start.sh

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo ""
echo "🎓 Angol Tanulás WebApp indítása..."
echo "📁 Könyvtár: $APP_DIR"
echo ""

# ── 1. npm install (csak ha kell) ──────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
    echo "📦 npm install futtatása..."
    npm install
    echo "✅ Csomagok telepítve."
else
    echo "✅ node_modules már megvan, kihagyva."
fi
echo ""

# ── 2. Ollama ellenőrzés / indítás ────────────────────────────────────────────
if curl -s http://localhost:11434 > /dev/null 2>&1; then
    echo "✅ Ollama már fut."
else
    echo "🤖 Ollama indítása (háttérben)..."
    ollama serve > /tmp/ollama.log 2>&1 &
    OLLAMA_PID=$!
    echo "   Ollama PID: $OLLAMA_PID"
    echo "   Várakozás az indulásra..."
    for i in {1..10}; do
        sleep 1
        if curl -s http://localhost:11434 > /dev/null 2>&1; then
            echo "✅ Ollama elindult."
            break
        fi
        if [ $i -eq 10 ]; then
            echo "⚠️  Ollama nem indult el 10 másodperc alatt."
            echo "   Manuálisan: ollama serve"
        fi
    done
fi
echo ""

# ── 3. llama3:8b modell ellenőrzés ────────────────────────────────────────────
if ollama list 2>/dev/null | grep -q "llama3:8b"; then
    echo "✅ llama3:8b modell megvan."
else
    echo "⬇️  llama3:8b letöltése (ez eltarthat néhány percig)..."
    ollama pull llama3:8b
    echo "✅ llama3:8b letöltve."
fi
echo ""

# ── 4. Szerver indítása ────────────────────────────────────────────────────────
echo "🚀 Express szerver indítása (port 3000)..."
node server.js &
SERVER_PID=$!
sleep 1

# Ellenőrzés
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "✅ Szerver fut (PID: $SERVER_PID)"
else
    echo "❌ Szerver nem indult el! Ellenőrizd a node és npm telepítést."
    exit 1
fi
echo ""

# ── 5. Böngésző megnyitása ─────────────────────────────────────────────────────
echo "🌐 Böngésző megnyitása: http://localhost:3000"
sleep 0.5
xdg-open http://localhost:3000 2>/dev/null || \
    sensible-browser http://localhost:3000 2>/dev/null || \
    echo "   Kézzel nyisd meg: http://localhost:3000"
echo ""

echo "════════════════════════════════════════"
echo "  ✅ App fut: http://localhost:3000"
echo "  🤖 Ollama:  http://localhost:11434"
echo "  📁 Vault:   /home/guszti/Obsidian_Vault"
echo "  🛑 Leállítás: Ctrl+C"
echo "════════════════════════════════════════"
echo ""

# Várakozás a szerverre (Ctrl+C leállítja)
wait $SERVER_PID
