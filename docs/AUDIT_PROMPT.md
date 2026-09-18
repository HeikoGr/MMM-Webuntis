# Repo-spezifischer Audit-Prompt

Nutze diesen Prompt, wenn du MMM-Webuntis gründlich prüfen sollst, aber vorerst **keine Codeänderungen** gewünscht sind.

## Ziel

Bitte prüfe MMM-Webuntis gründlich als gesamtes MagicMirror-Modul. Wir haben volle Hoheit über Frontend und Backend. Führe zuerst eine belastbare Bestandsaufnahme durch und prüfe, ob Architektur, Fehlerpfade, Laufzeitverhalten, Tests und Dokumentation dem aktuellen Qualitätsanspruch entsprechen.

Wichtig für diesen Durchlauf:
- vorerst **keine Codeänderungen**
- Dokumentation, Audit-Notizen und interne Notizen dürfen angelegt oder geändert werden
- Fokus auf reale Risiken, nicht auf Geschmacksfragen oder breite Refactoring-Wünsche

## Konkreter Prüfauftrag

1. Lies zuerst die vorhandene Repo-Dokumentation und prüfe, ob sie den tatsächlichen Code und das Laufzeitverhalten korrekt beschreibt.
2. Prüfe danach die kritischen Laufzeitpfade im Code, insbesondere:
   - `MMM-Webuntis.js`
   - `node_helper.js`
   - `lib/webuntis/authService.js`
   - `lib/webuntis/dataFetchOrchestrator.js`
   - `lib/webuntis/webuntisApiService.js`
   - `lib/webuntis/restClient.js`
   - `lib/frontendShared.js`
   - `plugins/grid/frontend.js`
   - `plugins/lessons/frontend.js`
3. Beurteile, ob das Modul entlang bestehender Repo-Patterns und dokumentierter Architektur umgesetzt ist.
4. Nenne Best-Practice-Abweichungen nur dann, wenn sie konkret begründbar sind und ein echtes Wartungs-, Robustheits- oder UX-Risiko darstellen.

## Schwerpunktproblem

Ein mittelfristig besonders wichtiger Punkt ist folgender Produktionsfehler:

- Sporadisch kann kein Stundenplan geladen werden.
- Das Display zeigt dann teilweise `kein Unterricht` oder eine ähnlich harmlose Leeraussage an.
- Diese UX ist problematisch, weil sie einen Daten- oder Ladefehler als fachlich korrekten Zustand tarnt.

Bitte prüfe deshalb gezielt:
- an welchen Stellen ein leerer Stundenplan fachlich als „wirklich kein Unterricht“ interpretiert wird
- welche Warn-, Status- oder Preserve-Mechanismen bereits existieren
- ob Frontend und Backend Fehlerzustände konsistent transportieren
- ob die Dokumentation klar genug zwischen `keine Daten vorhanden`, `keine Stunden im Zeitraum`, `Plan gesperrt` und `Fetch fehlgeschlagen` unterscheidet
- welche Teile bereits robust wirken und wo die wahrscheinlichsten Ursachen für die sporadischen Ausfälle liegen

## Prüfkriterien

Bewerte insbesondere:
- Architekturtreue zur dokumentierten Trennung zwischen Frontend, MagicMirror-Adapter, WebUntis-Core und Payload-Adapter
- Robustheit von Auth, Token-Caching, Retry-, Backoff- und Skip-Logik
- Korrektheit des `timetable-first`-Ansatzes und seiner Auswirkungen auf Folge-APIs
- Umgang mit leeren API-Antworten, Warning-Metadaten und `state.api`-Statusinformationen
- Frontend-Verhalten bei Fehlern, leeren Collections und erhaltenen Alt-Daten
- Testabdeckung für kritische Fehler- und Leerzustände
- Dokumentationsqualität: korrekt, vollständig, widerspruchsfrei, praxisnah für Debugging

## Erwartetes Ergebnisformat

Liefere das Ergebnis in dieser Reihenfolge:

1. Findings mit Priorität, jeweils mit Datei-/Pfadbezug und kurzer Begründung
2. Dokumentationslücken oder dokumentarische Widersprüche
3. Offene Fragen oder Annahmen
4. Erst danach eine kurze Gesamteinschätzung

Wenn du keine belastbaren Findings findest, sage das explizit. Benenne dann trotzdem verbleibende Risiken, Beobachtungslücken und fehlende Tests.

## Explizite Arbeitsgrenzen

- Keine Codeänderungen in diesem Durchlauf
- Keine Refactorings „auf Vorrat"
- Keine Kompatibilitätslayer vorschlagen, wenn Frontend und Backend synchron deployt werden
- Dokumentation und interne Notizen dürfen aktualisiert werden, wenn sie nachweisbar helfen

## Relevante Startdokumente

- `README.md`
- `wiki/Troubleshooting.md`
- `docs/ARCHITECTURE.md`
- `docs/SERVER_REQUEST_FLOW.md`
- `docs/API_REFERENCE.md`
- `docs/API_V3_MANIFEST.md`
- `.github/copilot-instructions.md`
