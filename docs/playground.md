# Playground

Scriptable läuft nur auf iOS/iPadOS; eine Testumgebung für den Echtlauf gibt es hier nicht (`PLATFORM-IMPOSSIBLE`).

## Was die KI hier prüft
- `scripts/keel-doctor` – Werkzeuge vorhanden.
- `node --check Finance.js && node --check Kategorien-Editor.js` – Syntax.
- künftig `node --test tests/` – reine Funktionen (Parser, Rechnungen) mit Attrappen der Scriptable-APIs (G-05).

## Echtlauf (Nutzer)
1. `Finance.js` aus dem Branch nach `iCloud Drive/Scriptable/` kopieren (am besten unter neuem Namen, damit der produktive Stand bleibt).
2. In Scriptable starten. Mit echten Daten arbeiten heißt: vorher `Depotbestand/` sichern (D-006).
3. Ergebnis und Fehlerlog (⚙️ → Diagnose) zurückmelden.
