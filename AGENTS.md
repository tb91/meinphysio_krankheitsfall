# AGENTS.md: meinphysio+ Case "Der Ausfall"

Instruktionen für Coding Agents (Claude Code, Codex, Cursor, …) in diesem Repository.
Diese Datei ist die maßgebliche Quelle. `CLAUDE.md` importiert sie und ergänzt nur Claude-spezifisches.

## 1. Worum es geht

Montag, 7. September 2026, 07:40 Uhr: Physiotherapeutin **Anna Weber** (`prac_01`) meldet sich krank.
Sie hat heute 14 gebuchte Termine an beiden Standorten, der erste um 08:00 Uhr.
Der Empfang muss in Minuten entscheiden: **umbuchen, absagen, wen wie informieren.**

Wir bauen einen Service mit Oberfläche, der diese Entscheidungen **vorbereitet und beschleunigt**,
aber nicht heimlich trifft. Der Mensch am Empfang bestätigt, das System schlägt vor und begründet.

Bewertet wird **Urteilsvermögen, nicht Umfang.** Timebox: 3 Stunden insgesamt.
Lieber ein schmaler, durchdachter Pfad, der funktioniert, als viele halbe Features.

## 2. Produktprinzipien (bei jeder Entscheidung anwenden)

1. **Zeitdruck zuerst.** Sortierung nach Startzeit; der nächste Termin steht oben. Was in den nächsten
   30–60 Min. beginnt, braucht eine Telefonaktion, keine E-Mail.
2. **Vorschlag + Begründung, Mensch entscheidet.** Jeder Vorschlag (Ersatz-Therapeut:in, Absage)
   zeigt *warum* (Qualifikation passt, Standort passt, frei laut Arbeitszeit und Kalender, VO-Frist).
3. **Unsichere Daten sichtbar machen, nie still raten.** Fehlende Zuordnung, abweichende Namen,
   fehlende Telefonnummer, unbekannte IDs → sichtbare Warnung am Termin, nicht verschlucken.
4. **Termino ist die Wahrheit für Termine, wir für Stammdaten und Verordnungen.** Wir schreiben nicht
   zurück nach Termino (keine API vorhanden). Umbuchungen sind Entscheidungen + Aufgaben für den
   Empfang, die in Termino nachgezogen werden müssen. Das muss die UI klar sagen.
5. **Idempotent gegenüber neuen Exporten.** Alle 5 Min. kommt ein vollständiger Export. Re-Import
   darf getroffene Entscheidungen nicht zerstören, muss aber Änderungen (neu, storniert, verschoben)
   erkennen und am Fall markieren.
6. **Bewusst weglassen und dokumentieren.** Was wir nicht bauen, kommt in die README unter
   "Bewusst weggelassen". Keine Auth, kein CI, kein Deployment, keine Vollabdeckung mit Tests.

## 3. Daten: Fakten und bekannte Fallen

Rohdaten liegen unter `data/` (Kopie aus `github.com/meinphysioplus/case-study-der-ausfall`).
**Rohdaten nie verändern.** Bereinigung passiert beim Import und wird nachvollziehbar protokolliert.

| Datei | Inhalt |
| --- | --- |
| `praxen.json` | 2 Standorte: Mitte (`loc_01`), Kreuzberg (`loc_02`) |
| `therapeuten.json` | 7 Personen, Qualifikationen, Arbeitszeiten je Wochentag (lokale Zeit, inkl. Standort) |
| `patienten.json` | 560 Stammdatensätze, Verknüpfung über `termino_patient_id` |
| `verordnungen.json` | 557 Heilmittelverordnungen (KG, MT, MLD45, KGG) |
| `termino_export_2026-09-07_0800.json` / `_0805.json` | Vollexport aller Termine, Fenster 24.08.–13.09. |

Bekannte Auffälligkeiten (aus erster Sichtung, beim Bauen verifizieren und erweitern):

- **Zeitzonen:** `starts_at` ist UTC (`…Z`), Arbeitszeiten sind Berliner Ortszeit (Sept. = CEST, UTC+2).
  `06:00Z` = 08:00 Uhr. Immer explizit mit `Europe/Berlin` umrechnen, nie Offset hardcoden.
- **Service-Mapping:** Termino-Bezeichnungen ≠ interne Codes:
  `Krankengymnastik`→`KG`, `Manuelle Therapie`→`MT`, `Lymphdrainage 45 Min.`→`MLD45` (Dauer im Export: **40** Min.!),
  `Geraetegestuetzte Krankengymnastik`→`KGG` (60 Min.).
- **Unbekannte Therapeut:in:** `prac_03` taucht im Export auf (bis 28.08.), fehlt aber in `therapeuten.json`.
- **Patient:innen-Matching unsauber:**
  - "Katrin Meier" (`pat_02538`) in Termino ↔ "Katrin Meyer", gleiches Geburtsdatum, gleiche E-Mail, in Stammdaten **ohne** `termino_patient_id`.
  - "Lena Krause" (`pat_03115`) hat keinen Stammdatensatz und keine Verordnung.
  - Matching-Reihenfolge: `termino_patient_id` → (Geburtsdatum + E-Mail/Telefon + Namensähnlichkeit) als *Vorschlag mit Warnung*, nie stilles Mergen.
- **Kontaktdaten:** Gisela Neumann hat keine Telefonnummer (nur E-Mail), Termin 09:40 Uhr. Zu knapp für E-Mail allein → Warnung.
- **Doppelbuchung:** Marek Kowalski hat heute zwei KG-Termine bei Anna (10:00 Mitte, 16:20 Kreuzberg) bei VO mit 1×/Woche.
- **Stornierte Termine** (`status: cancelled`) zählen nicht zu den 14, müssen aber erkannt werden (Anna: 15 Einträge, 1 storniert).
- **Export-Diff 08:00 → 08:05:** 2 geänderte, 1 neuer Termin (andere Therapeut:innen). Re-Import muss Diffs erkennen.
- **Verordnungsfristen (fachlich, vor Umsetzung gegen Heilmittel-Richtlinie prüfen):** Behandlungsbeginn
  innerhalb 28 Tagen nach Ausstellung, Unterbrechung max. 14 Tage. Beispiel: Cem Oeztuerk, VO vom 12.08.,
  bisher kein Termin → Erstbehandlung muss bis ca. 09.09. stattfinden. Umbuchen auf "nächste Woche" wäre falsch.
  Solche Regeln als klar benannte, getestete Funktionen implementieren und in der README als Annahme kennzeichnen.

## 4. Fachliche Entscheidungslogik (Zielbild, iterativ bauen)

Für jeden betroffenen Termin von Anna heute:

1. **Ersatz am selben Tag/Slot suchen:** Therapeut:in mit passender Qualifikation, am selben Standort
   laut Arbeitszeiten anwesend, im Termino-Export zu der Zeit frei (gebuchte, nicht stornierte Termine belegen).
2. **Sonst Umbuchung vorschlagen:** nächste passende freie Slots, unter Beachtung der Verordnungsfristen
   und Frequenz.
3. **Sonst Absage** mit klarer Begründung.
4. **Kommunikation:** Kanal nach Dringlichkeit und verfügbaren Kontaktdaten; Textvorschlag generieren.
   Nichts wird tatsächlich versendet, nur vorbereitet und als erledigt markiert.
   - Termin in ≤ 2 h: erst Anruf, bei "nicht erreicht" SMS + E-Mail. Termin in > 2 h: SMS + E-Mail.
   - Schriftlich heißt immer SMS UND E-Mail (soweit vorhanden), nicht entweder/oder.
     SMS auch an Festnetznummern (viele Anbieter lesen sie vor).
   - Informiert = telefonisch erreicht ODER alle verfügbaren schriftlichen Kanäle bestätigt.
   - Anruf in zwei Schritten: "Angerufen" → "Erreicht" (= informiert) oder "Nicht erreicht".
     Ein nicht erreichter Anruf wird immer protokolliert und nie entfernt; danach ist SMS + E-Mail dran.
5. **Status je Fall:** offen → entschieden → informiert → in Termino nachgezogen.
   Die Bestätigungen "informiert" und "in Termino" sind Umschalter: erst ein Klick markiert sie,
   ein erneuter Klick nimmt sie zurück und entfernt den Protokolleintrag (Produktentscheidung,
   nicht sicherheitsrelevant). Entscheidungen (umbuchen/absagen) bleiben append-only.
   Nichts ist vorausgewählt: Empfehlungen werden als Text gezeigt, nicht als markierter Button.

Ersatzvergabe muss **global konsistent** sein: zwei von Annas Terminen dürfen nicht demselben freien Slot
derselben Person zugewiesen werden. Lieber einfacher Greedy-Algorithmus nach Startzeit als cleverer Solver.

## 5. Tech-Stack und Rahmen

Vorgaben: **TypeScript, PostgreSQL, React**, Start mit **einem Befehl** (`docker compose up`).

Bevorzugt (Abweichung nur mit Begründung in der README):

- Monorepo mit npm workspaces: `apps/api`, `apps/web`, optional `packages/shared` für Typen/Zod-Schemas.
- Backend: Node 22 + Fastify, Zod für Validierung der Rohdaten und API, SQL über Drizzle oder Kysely.
- Migrationen + Seed/Import laufen beim Container-Start automatisch.
- Frontend: Vite + React + TanStack Query; schlichtes UI (z. B. Tailwind), keine Designarbeit über Lesbarkeit hinaus.
- Tests: Vitest, **nur** für die Domänenlogik (Matching, Zeitzonen, Verfügbarkeit, VO-Fristen).

Konventionen:

- Domänenlogik als reine Funktionen ohne DB/HTTP (`apps/api/src/domain/`), damit sie testbar ist.
- Domänenbegriffe auf Deutsch, wo sie fachlich sind (`Verordnung`, `Heilmittel`), Code sonst Englisch. Konsistent bleiben.
- Zeit intern immer UTC (`timestamptz`), Anzeige in `Europe/Berlin`.
- Die "aktuelle Zeit" ist konfigurierbar (`NOW=2026-09-07T07:40:00+02:00`), da das Szenario in der Vergangenheit liegt.
- Keine echten Personendaten in Logs außerhalb der Fiktivdaten, kein Versand an externe Dienste.

## 6. Arbeitsweise

- **Erst verstehen, dann bauen.** Bei unklarer Fachlichkeit Annahme treffen, im Code kurz kommentieren und
  in der README unter "Annahmen" festhalten. Echte Rückfragen sammeln (Ansprechpartner: siehe Case).
- **Kleine, sprechende Commits** (Commit-Historie wird bewertet). Ein Commit pro logischem Schritt.
- **Timebox respektieren.** Reihenfolge: Import + Datenqualität → Betroffene Termine anzeigen → Ersatz-Vorschläge
  → Entscheidung speichern → Kommunikationstext → Re-Import/Diff. Wenn die Zeit endet: Stand in README unter
  "Wo ich abgebrochen habe" dokumentieren.
- Keine Features außerhalb des Scopes ohne Rückfrage (Auth, Multi-Tenant-Umsetzung, Termino-Schreib-API).
  Mandantenfähigkeit gehört in `ARCHITECTURE.md`, nicht in den Code.
- Nach Änderungen: `docker compose up` muss weiterhin aus frischem Zustand funktionieren.
- Annahme: Wir befinden uns in einer getrennten Umgebung. Kein Zugriff aufs Produktionssystem -> Du darfst die Datenbank frei löschen/neu erstellen, hinzufügen ohne Rückfragen.
- Annahme: ich gehe davon aus, dass es nur eine rezeption gibt, also eine Person die zeitgleich daran arbeitet.

## 7. Abgabe-Artefakte (im Blick behalten)

- `README.md`: Annahmen, bewusst Weggelassenes, nächste Schritte, Begründung der Library-Wahl, Abbruchpunkt.
- `ARCHITECTURE.md`: kurze Eckpfeiler für 100+ Praxen, mandantenfähig.
- `AGENTS.md` / `CLAUDE.md`: diese Instruktionen (bei Lernmomenten aktualisieren).
- Prompts/Transkripte der Agent-Sessions.
