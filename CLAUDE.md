# CLAUDE.md

@AGENTS.md

## Ergänzungen für Claude Code

- `AGENTS.md` ist die maßgebliche Quelle für Fachlichkeit, Datenfallen, Stack und Arbeitsweise.
  Neue Erkenntnisse (z. B. weitere Datenfehler) dort eintragen, nicht hier, damit alle Agents sie sehen.
- **Plan vor Code** bei allem, was mehr als eine Datei betrifft: kurz Ansatz und Trade-off nennen, dann bauen.
- **Daten vor Annahmen:** Bevor Logik auf eine Annahme über die Daten baut, mit einem kurzen Node-Skript
  gegen `data/` prüfen (Skripte in den Scratchpad, nicht ins Repo, außer sie werden Teil des Imports).
- **Zeitbudget im Blick:** Wenn ein Schritt deutlich länger dauert als geplant, anhalten und den Nutzer fragen,
  ob vereinfacht oder weggelassen werden soll, statt still weiterzubauen.
- **Commits:** nur auf Anweisung, klein und sprechend (Deutsch oder Englisch, aber einheitlich).
  Attribution-Zeile gemäß Session-Vorgabe anhängen.
- **Verifikation:** Domänenlogik mit Vitest prüfen; UI-Änderungen im Browser-Pane gegen `docker compose up` ansehen.
  Ergebnis ehrlich berichten (was getestet, was nicht).
- **Shell:** Windows-Host; Bash (Git Bash) und PowerShell verfügbar. Pfade in Docker-/npm-Skripten plattformneutral halten.
- **Sprache:** Mit dem Nutzer und in Doku Deutsch; Code-Bezeichner Englisch außer fachlichen Domänenbegriffen.
