# Code Quality Todos

Quelle: Code-Review vom 2026-03-09
Status: offen

## Prioritaet Hoch

- [x] Magic Numbers fuer Auth-Timing zentralisieren
  - Dateien: lib/webuntis/authService.js
  - Aufgabe: TOKEN_TTL_MS und TOKEN_BUFFER_MS als Konstanten definieren und alle direkten Werte (300000, 5*60*1000, 14*60*1000) ersetzen.
  - Akzeptanz: Keine direkten Timing-Literale mehr in Auth-Flows.
  - Erledigt: 2026-03-09 - Konstanten TOKEN_TTL_MS (14 Minuten) und TOKEN_BUFFER_MS (5 Minuten) eingefuehrt

- [x] API-Timeouts zentralisieren
  - Dateien: lib/webuntis/webuntisApiService.js, lib/webuntis/authService.js, lib/webuntis/httpClient.js, lib/webuntis/restClient.js
  - Aufgabe: Gemeinsame API_TIMEOUT_MS-Konstante einfuehren und alle 15000-Werte ersetzen.
  - Akzeptanz: Genau eine zentrale Timeout-Definition.
  - Erledigt: 2026-03-09 - API_TIMEOUT_MS (15 Sekunden) Konstante in allen 4 Dateien eingefuehrt

- [x] Widget-Initialisierung entduplizieren (DRY)
  - Dateien: widgets/lessons.js, widgets/exams.js, widgets/homework.js, widgets/absences.js, widgets/messagesofday.js, widgets/grid.js, widgets/util.js
  - Aufgabe: Gemeinsamen Helper fuer createWidgetContext/Header/Label einfuehren.
  - Akzeptanz: Wiederholte Initialisierungsbloecke in Widgets entfernt.
  - Erledigt: 2026-03-09 - initializeWidgetContextAndHeader() Helper in util.js eingefuehrt und in 5 Widgets verwendet (exams, homework, absences, messagesofday, lessons; grid behaelt spezielle Struktur)

- [x] Doppelte Debug-Dump-Logik in Auth-Service extrahieren
  - Dateien: lib/webuntis/authService.js
  - Aufgabe: Gemeinsame Funktion fuer Verzeichnis-Erstellung, Dateinamen und writeFileSync verwenden.
  - Akzeptanz: Dump-Logik an nur einer Stelle.
  - Erledigt: 2026-03-10 - Helper _writeDebugDump() eingefuehrt und beide app/data-Dump-Pfade auf den Helper umgestellt

## Prioritaet Mittel

- [x] Datumsformatierung vereinheitlichen
  - Dateien: lib/webuntis/webuntisApiService.js, lib/webuntis/dataOrchestration.js, lib/webuntis/restClient.js
  - Aufgabe: Redundante Date-Formatter zusammenfuehren (YYYYMMDD und YYYY-MM-DD sauber kapseln).
  - Akzeptanz: Keine duplizierten Datums-Formatter mit gleicher Verantwortung.
  - Erledigt: 2026-03-10 - Zentrale dateUtils.js eingefuehrt und Formatter-Nutzung in den drei Dateien vereinheitlicht

- [x] Sortier-Comparator in Widgets vereinheitlichen
  - Dateien: widgets/absences.js, widgets/exams.js, optional weitere Widgets
  - Aufgabe: Gemeinsamen Comparator-Helper in widgets/util.js einfuehren.
  - Akzeptanz: Einheitliche Sortierlogik in allen Listen-Widgets.
  - Erledigt: 2026-03-10 - compareByDateAndStartTime() in util.js eingefuehrt und in absences/exams verwendet

- [x] HHMM-Zeitberechnung als Utility kapseln
  - Dateien: widgets/lessons.js, widgets/exams.js, widgets/util.js
  - Aufgabe: nowHm-Berechnung ueber Utility (z. B. currentTimeAsHHMM) nutzen.
  - Akzeptanz: Kein getHours()*100 + getMinutes() in Widgets.
  - Erledigt: 2026-03-10 - currentTimeAsHHMM() in util.js eingefuehrt und in lessons/exams verwendet

- [x] HTTP-Status-Text-Mapping aus callRestAPI herausziehen
  - Dateien: lib/webuntis/restClient.js
  - Aufgabe: STATUS_TEXTS als Modulkonstante definieren statt pro Call neu aufzubauen.
  - Akzeptanz: Keine per-Request-Neuinitialisierung des Status-Mappings.
  - Erledigt: 2026-03-10 - STATUS_TEXTS auf Modul-Ebene eingefuehrt und getStatusText() ausgelagert

## Prioritaet Niedrig

- [x] Auskommentierten/dead Code entfernen
  - Dateien: lib/webuntis-client/payloadBuilder.js, widgets/exams.js
  - Aufgabe: Veraltete, auskommentierte Bloecke loeschen.
  - Akzeptanz: Keine toten Kommentar-Codepfade mehr in diesen Dateien.
  - Erledigt: 2026-03-10 - veralteten Kommentarblock in exams entfernt und unnoetige eslint-disable-Kommentarpfade in payloadBuilder bereinigt

- [x] Logger-Signatur vereinheitlichen
  - Dateien: lib/webuntis/errorUtils.js, ggf. widgets/util.js
  - Aufgabe: Einheitliche Logger-API festlegen, Fallback-Pfade reduzieren.
  - Akzeptanz: Keine try/catch-Fallbacks nur wegen Signaturunterschieden.
  - Erledigt: 2026-03-10 - logger-Signatur in errorUtils via Arity-Normalisierung vereinheitlicht (3/2/1-arg), Signatur-Fallback-Try/Catch entfernt

- [x] Benennung fuer Datumsvariablen konsolidieren
  - Dateien: mehrere (v. a. widgets/grid.js, widgets/lessons.js, lib/webuntis/*)
  - Aufgabe: Konvention festlegen (z. B. ymd fuer Integer, date fuer Date-Objekt).
  - Akzeptanz: Neue/angepasste Stellen folgen der Konvention.
  - Erledigt: 2026-03-10 - Date/ymd-Benennung in lessons/grid/dataOrchestration konsolidiert (entryYmdStr/dayYmdStr/entryDate/dateValue)

## Optionale groessere Refactorings

- [x] orchestrateFetch in kleinere Einheiten aufteilen (SRP)
  - Datei: lib/webuntis/dataFetchOrchestrator.js
  - Idee: validateFetchParams, buildAuthContext, fetchTimetablePhase, fetchParallelPhase, mergeResults.
  - Erledigt: 2026-03-10 - In Phasen-Helper aufgeteilt (validateFetchParams, buildOrchestratorContext, buildTargetHelpers, runAuthCanaryIfNeeded, fetchTimetablePhase, buildParallelFetchPlans)

- [x] buildGotDataPayload modularisieren
  - Datei: lib/webuntis-client/payloadBuilder.js
  - Idee: Redaction, Compaction, Warning-Assembly und Debug-Dump in getrennte Funktionen.
  - Erledigt: 2026-03-10 - In Helper aufgeteilt (Compaction, Base-Payload, Meta-Anreicherung, Warning-Assembly, Redaction/Ordering, Debug-Dump)
