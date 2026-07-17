## Plan: ICS- und CalDAV-Bereitstellung für MMM-Webuntis

Ziel ist ein robustes Feed-System, das tatsächlich stattfindende Stunden und Klausuren als getrennte Kalender bereitstellt, primär für das MagicMirror-Standardmodul calendar über ICS. Die Umsetzung erfolgt in zwei Stufen: Phase 1 liefert stabile, schülerbezogene ICS-Feeds (plus .ical-Alias), Phase 2 ergänzt optional CalDAV. Dadurch wird der direkte Mehrwert für MagicMirror schnell erreicht, ohne die erste Version durch CalDAV-Komplexität zu verzögern.

**Theoretische Verifikation**
- Im MagicMirror-Umfeld ist die Bereitstellung eines ICS-Feeds per URL grundsätzlich möglich.
- Der technische Grund ist, dass MagicMirror jedem NodeHelper ein Express-App-Objekt zur Verfügung stellt; das Modul kann daher eigene HTTP-Endpunkte im bestehenden MagicMirror-Prozess registrieren, statt zwingend einen separaten Server zu starten.
- Für MMM-Webuntis ist das architektonisch passend, weil die benötigten Daten (`lessons`, `exams`) bereits als kanonisch normalisierte Backend-Collections vorliegen und nach erfolgreichem Fetch zentral im DATA_UPDATE-Pfad erzeugt werden.
- Das MagicMirror-Standardmodul `calendar` arbeitet URL-basiert, lädt ICS-Inhalte per HTTP und parst sie serverseitig. Ein von MMM-Webuntis ausgelieferter Feed ist deshalb mit dem Standardmodul kompatibel, solange gültiges iCalendar (`text/calendar`) zurückgegeben wird.
- Schlussfolgerung für Phase 1: Ein URL-Feed innerhalb des bestehenden Node-/MagicMirror-Prozesses ist der richtige Primärweg. Ein separater interner HTTP-Server ist nur noch ein optionaler Fallback, nicht mehr die wahrscheinliche Hauptlösung.

**Schritte**
1. Scope und Datenregeln finalisieren
- Definiere verbindlich die enthaltenen Datentypen je Feed:
  - Unterrichtsfeed: nur tatsächlich stattfindende Stunden (alle relevanten Unterrichtsereignisse außer abgesagten Stunden)
  - Klausurfeed: alle Einträge aus dem Exams-Datenkanal
- Definiere Statusfilter für Unterricht aus der kanonischen Lessons-Struktur:
  - Einschließen: REGULAR, CHANGED, ADDITIONAL, SUBSTITUTION, SUBSTITUTE, EVENT, MOVED, BREAK_SUPERVISION (soweit als Unterrichtseintrag vorhanden)
  - Ausschließen: CANCELLED
- Definiere Zeit-/Datumsnormalisierung auf Basis der bestehenden HHMM-/YYYYMMDD-Normalisierung.

2. Architektur für Feed-Bereitstellung festlegen
- Neue Backend-Teilschicht für Kalender-Export entwerfen (domainnah, ohne Frontend-Abhängigkeit):
  - Feed-Projektion: aus vorhandenem DATA_UPDATE-nahen Datenmodell bzw. Core-Bundle ableiten
  - Serialisierung: iCalendar-konformes VCALENDAR/VEVENT-Rendering
  - Delivery: HTTP-Auslieferung mit getrennten Endpunkten pro Schüler und Feedtyp
- Entscheidung für Phase 1:
  - Primär ICS-Endpunkte für MagicMirror calendar
  - .ical als Alias auf identischen Inhalt

3. Integrationspunkt im Backend bestimmen
- Technischen Einstiegspunkt in der Backend-Laufzeit definieren:
  - bevorzugt innerhalb des bestehenden Node-Helper-Lifecycle, damit gleiche Session-/Config-Logik gilt
- Verifiziert: HTTP-Routen koennen direkt im MagicMirror-NodeHelper-Kontext registriert werden.
- Empfehlung fuer Phase 1:
  - Feed-Routen am bestehenden MagicMirror-Express-App-Objekt registrieren
  - URL-Namespace unter dem Modulpfad halten, damit Mehrinstanzen und Reverse-Proxy-Setups nachvollziehbar bleiben
- Fallback-Strategie nur fuer Sonderfaelle dokumentieren:
  - kleiner interner HTTP-Server auf konfigurierbarem Port, falls eine getrennte externe Bereitstellung spaeter ausdruecklich gewuenscht ist

4. Feed-Lebenszyklus und Caching designen
- Definiere Feed-Cache pro sessionKey + student + feedType:
  - Schlüssel: identifier, sessionId, studentId/studentTitle, feedType
  - Update: bei erfolgreichem Fetch und erfolgreicher Payload-Aufbereitung
  - Read: HTTP-Endpunkt liefert zuletzt bekannte Version
- Definiere Stale-Verhalten:
  - Wenn noch kein erfolgreicher Fetch vorliegt: leerer Kalender mit PRODID/VERSION und erklärender Beschreibung statt Fehlerseite
  - Bei temporären API-Ausfällen: letzte gültige Version weiter ausliefern
- Definiere Aktualisierungssemantik:
  - Last-Modified/ETag (optional in Phase 1, empfohlen)
  - Cache-Control passend zu updateInterval

5. Event-Mapping-Regeln spezifizieren
- Unterricht zu VEVENT:
  - DTSTART/DTEND aus date + startTime/endTime
  - SUMMARY aus Fach/Lehrkraft/Raum nach klarer Priorität
  - DESCRIPTION mit substitutionText/lessonText und Änderungsinformationen
  - LOCATION aus Raumdaten
  - UID deterministisch aus student + lesson-id + date + start/end
- Klausuren zu VEVENT:
  - DTSTART/DTEND aus examDate/startTime/endTime
  - SUMMARY mit Klausurname/Fach
  - DESCRIPTION aus text + Lehrkräften
  - UID deterministisch aus student + examDate + start/end + subject/name
- Tageshinweise (dayNotices):
  - In Phase 1 nicht als eigene VEVENTs exportieren (bewusster Scope-Ausschluss), um Feed semantisch klar zu halten

6. Zeitzone, iCalendar-Compliance und Kompatibilität absichern
- Zeitzone aus context.timezone verwenden, Fallback Europe/Berlin
- RFC5545-konforme Zeilenfaltung und Escape-Regeln für Textfelder definieren
- Pflichtfelder sicherstellen:
  - VCALENDAR: VERSION, PRODID, CALSCALE
  - VEVENT: UID, DTSTAMP, DTSTART
- DATE-TIME-Format festlegen (empfohlen: lokale Zeit mit TZID); optional später UTC-Variante als Kompatibilitätsoption

7. HTTP-Endpunktdesign definieren
- Schülergetrennte Endpunkte (Phase 1):
  - lessons.ics
  - exams.ics
  - lessons.ical (Alias)
  - exams.ical (Alias)
- Pfadschema klar dokumentieren:
  - inklusive identifier/session-Kontext, damit Mehrinstanzen parallel sauber trennbar sind
- Content-Type und Header:
  - text/calendar; charset=utf-8
  - optional Content-Disposition für Download-freundliche Namen

8. Konfigurationsmodell erweitern
- Neue optionale Konfigsektion entwerfen, z. B. calendarExport:
  - enabled
  - basePath oder port (je nach gewähltem Delivery-Modell)
  - lessons.enabled, exams.enabled
  - includeAliasesIcal
  - optional future: authToken (auch wenn aktuell nicht gewünscht)
- Legacy-Mapping bewusst nicht überdehnen; neue Optionen kanonisch halten.

9. CalDAV als optionale Ausbaustufe (Phase 2) planen
- CalDAV nicht in Erstrelease blockierend machen.
- Zielbild Phase 2:
  - Read-only CalDAV Collections pro Schüler und Feedtyp
  - optional Discovery (well-known) abhängig von technischem Aufwand
- Vorab evaluieren:
  - Bibliothek vs. minimaler eigener Read-only-Layer
  - Interoperabilität mit gängigen Clients
- Klarer Hinweis: Für MagicMirror default calendar genügt ICS; CalDAV ist Mehrwert für externe Synchronisations-Ökosysteme.

10. Dokumentationspaket als eigenständige Leitlinie erstellen
- Eine eigenständige, umfassende Doku im docs-Bereich aufbauen mit:
  - Architekturübersicht (Flow von Fetch bis Feed)
  - Datenmappingtabellen Unterricht/Klausuren
  - Endpunktübersicht mit Beispielen
  - Integrationsbeispiel für MagicMirror calendar
  - Betriebsaspekte (Caching, Ausfallverhalten, bekannte Grenzen)
  - Roadmap für CalDAV Phase 2
- Querreferenzen zu bestehenden Architektur- und API-Dokumenten ergänzen.

11. Verifikation und Abnahmekriterien definieren
- Funktional:
  - Feed erreichbar pro Schüler und Kategorie
  - Abgesagte Stunden erscheinen nicht
  - Klausuren erscheinen korrekt im separaten Feed
- Kompatibilität:
  - Import im MagicMirror default calendar erfolgreich
  - Keine Parsing-Fehler in mindestens einem externen Validator
- Stabilität:
  - Bei API-Fehlern weiterhin gültiger Kalenderinhalt (letzter Stand)
  - Keine Regression im bestehenden Socket-Flow

**Relevant files**
- /opt/magic_mirror/modules/MMM-Webuntis/node_helper.js — Lifecycle, Session-Routing, Fetch-Orchestrierung, sinnvoller Integrationspunkt für Feed-Aktualisierung
- /opt/magic_mirror/modules/MMM-Webuntis/lib/webuntisClient.js — Fassade zwischen Core-Bundle und MMM-Payload, geeigneter Ort für exportfreundliche Datenabgriffe
- /opt/magic_mirror/modules/MMM-Webuntis/lib/mmm-adapter/mmmPayloadMapper.js — Kanonische Datenstruktur für lessons/exams, zentrale Grundlage fürs Mapping in VEVENT
- /opt/magic_mirror/modules/MMM-Webuntis/lib/webuntis/webuntisApiService.js — Ursprung und Bedeutung der Lesson-/Exam-Felder inkl. Statussemantik
- /opt/magic_mirror/modules/MMM-Webuntis/lib/webuntis/dataOrchestration.js — Datums-/Zeitnormalisierung und Range-Logik
- /opt/magic_mirror/modules/MMM-Webuntis/lib/frontendShared.js — bestehende Status-/Irregular-Semantik als Referenz für „tatsächlich stattfindend“
- /opt/magic_mirror/modules/MMM-Webuntis/docs/ARCHITECTURE.md — Architekturgrenzen für saubere Schichten
- /opt/magic_mirror/modules/MMM-Webuntis/docs/SERVER_REQUEST_FLOW.md — Request-/Retry-/Statusfluss für robusten Feed-Cache
- /opt/magic_mirror/modules/MMM-Webuntis/docs/API_V3_MANIFEST.md — kanonischer Runtime-Vertrag (data/context/state)
- /opt/magic_mirror/modules/MMM-Webuntis/docs/API_REFERENCE.md — externe API-Semantik als Grundlage für Feldinterpretation

**Verification**
1. Unit-Tests für ICS-Serializer:
- korrekte Zeilenfaltung
- Escaping
- UID-Stabilität
- DTSTART/DTEND-Mapping

2. Unit-Tests für Filterlogik „tatsächlich stattfindende Stunden“:
- CANCELLED wird ausgeschlossen
- CHANGED/ADDITIONAL/SUBSTITUTION und reguläre Stunden werden eingeschlossen

3. Integrations-Tests für Endpunkte:
- lessons.ics und exams.ics je Schüler liefern gültiges VCALENDAR
- .ical-Aliase liefern identischen Inhalt

4. Manuelle Validierung mit MagicMirror calendar:
- beide Feed-URLs einbinden
- Darstellung und Refresh gemäß updateInterval prüfen

5. Qualitätslauf:
- node --run lint
- optional node --run check

**Decisions**
- Enthalten: Schülergetrennte Feeds
- Enthalten: Primärziel MagicMirror default calendar
- Enthalten: ICS in Phase 1, .ical als Alias
- Enthalten: CalDAV als optionale Phase 2
- Aktuell vom Auftraggeber gewünscht: keine Zugriffssicherung in Phase 1
- Explizit ausgeschlossen in Phase 1: Day-Notices als eigene Kalenderevents, bidirektionale CalDAV-Schreiboperationen

**Further Considerations**
1. Zugriffsschutz später aktivierbar machen
- Empfehlung: Token-basierte Absicherung als optionales Flag vorbereiten, auch wenn initial deaktiviert

2. Multi-Instanz-URL-Strategie
- Empfehlung: identifier und session-konforme URL-Namespacing-Regel früh festlegen, um Kollisionen zwischen mehreren Modulinstanzen zu verhindern

3. CalDAV-Komplexität begrenzen
- Empfehlung: Read-only Collections priorisieren, keine Schreib-/Sync-Konfliktlogik in Phase 2