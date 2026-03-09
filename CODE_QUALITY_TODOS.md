# Code Quality Todos

Quelle: Code-Review vom 2026-03-09
Status: offen

## Prioritaet Hoch

- [ ] Magic Numbers fuer Auth-Timing zentralisieren
  - Dateien: lib/webuntis/authService.js
  - Aufgabe: TOKEN_TTL_MS und TOKEN_BUFFER_MS als Konstanten definieren und alle direkten Werte (300000, 5*60*1000, 14*60*1000) ersetzen.
  - Akzeptanz: Keine direkten Timing-Literale mehr in Auth-Flows.

- [ ] API-Timeouts zentralisieren
  - Dateien: lib/webuntis/webuntisApiService.js, lib/webuntis/authService.js, lib/webuntis/httpClient.js, lib/webuntis/restClient.js
  - Aufgabe: Gemeinsame API_TIMEOUT_MS-Konstante einfuehren und alle 15000-Werte ersetzen.
  - Akzeptanz: Genau eine zentrale Timeout-Definition.

- [ ] Widget-Initialisierung entduplizieren (DRY)
  - Dateien: widgets/lessons.js, widgets/exams.js, widgets/homework.js, widgets/absences.js, widgets/messagesofday.js, widgets/grid.js, widgets/util.js
  - Aufgabe: Gemeinsamen Helper fuer createWidgetContext/Header/Label einfuehren.
  - Akzeptanz: Wiederholte Initialisierungsbloecke in Widgets entfernt.

- [ ] Doppelte Debug-Dump-Logik in Auth-Service extrahieren
  - Dateien: lib/webuntis/authService.js
  - Aufgabe: Gemeinsame Funktion fuer Verzeichnis-Erstellung, Dateinamen und writeFileSync verwenden.
  - Akzeptanz: Dump-Logik an nur einer Stelle.

## Prioritaet Mittel

- [ ] Datumsformatierung vereinheitlichen
  - Dateien: lib/webuntis/webuntisApiService.js, lib/webuntis/dataOrchestration.js, lib/webuntis/restClient.js
  - Aufgabe: Redundante Date-Formatter zusammenfuehren (YYYYMMDD und YYYY-MM-DD sauber kapseln).
  - Akzeptanz: Keine duplizierten Datums-Formatter mit gleicher Verantwortung.

- [ ] Sortier-Comparator in Widgets vereinheitlichen
  - Dateien: widgets/absences.js, widgets/exams.js, optional weitere Widgets
  - Aufgabe: Gemeinsamen Comparator-Helper in widgets/util.js einfuehren.
  - Akzeptanz: Einheitliche Sortierlogik in allen Listen-Widgets.

- [ ] HHMM-Zeitberechnung als Utility kapseln
  - Dateien: widgets/lessons.js, widgets/exams.js, widgets/util.js
  - Aufgabe: nowHm-Berechnung ueber Utility (z. B. currentTimeAsHHMM) nutzen.
  - Akzeptanz: Kein getHours()*100 + getMinutes() in Widgets.

- [ ] HTTP-Status-Text-Mapping aus callRestAPI herausziehen
  - Dateien: lib/webuntis/restClient.js
  - Aufgabe: STATUS_TEXTS als Modulkonstante definieren statt pro Call neu aufzubauen.
  - Akzeptanz: Keine per-Request-Neuinitialisierung des Status-Mappings.

## Prioritaet Niedrig

- [ ] Auskommentierten/dead Code entfernen
  - Dateien: lib/webuntis-client/payloadBuilder.js, widgets/exams.js
  - Aufgabe: Veraltete, auskommentierte Bloecke loeschen.
  - Akzeptanz: Keine toten Kommentar-Codepfade mehr in diesen Dateien.

- [ ] Logger-Signatur vereinheitlichen
  - Dateien: lib/webuntis/errorUtils.js, ggf. widgets/util.js
  - Aufgabe: Einheitliche Logger-API festlegen, Fallback-Pfade reduzieren.
  - Akzeptanz: Keine try/catch-Fallbacks nur wegen Signaturunterschieden.

- [ ] Benennung fuer Datumsvariablen konsolidieren
  - Dateien: mehrere (v. a. widgets/grid.js, widgets/lessons.js, lib/webuntis/*)
  - Aufgabe: Konvention festlegen (z. B. ymd fuer Integer, date fuer Date-Objekt).
  - Akzeptanz: Neue/angepasste Stellen folgen der Konvention.

## Optionale groessere Refactorings

- [ ] orchestrateFetch in kleinere Einheiten aufteilen (SRP)
  - Datei: lib/webuntis/dataFetchOrchestrator.js
  - Idee: validateFetchParams, buildAuthContext, fetchTimetablePhase, fetchParallelPhase, mergeResults.

- [ ] buildGotDataPayload modularisieren
  - Datei: lib/webuntis-client/payloadBuilder.js
  - Idee: Redaction, Compaction, Warning-Assembly und Debug-Dump in getrennte Funktionen.
