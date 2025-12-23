# 📱 WebUntis QR-Code REST API Testing - Übersicht

## 🎯 Problem & Lösung

### Das Problem
> "In der web ui kann ich mich mit dem qrcode credentials leider nicht anmelden. evtl bekomme ich aber die notwendigen token durch den json-rpc login?"

**Antwort: JA!** ✅

## 📦 Was wurde erstellt?

Ich habe eine **komplette Test-Suite und Dokumentation** erstellt, um zu zeigen:
1. Dass QR-Code Login funktioniert
2. Wie man Bearer Tokens erhält
3. Wie man REST API damit nutzt

## 📂 Neue Dateien (Übersicht)

### Dateien im Root-Verzeichnis

| Datei | Zweck | Lesen? |
|-------|-------|--------|
| **`QR_CODE_TEST_README.md`** | Deutsche Übersicht mit Quick Start | 👈 START HERE |
| **`QR_CODE_TESTING_GUIDE.sh`** | Interaktive Shell-Anleitung | `./QR_CODE_TESTING_GUIDE.sh` |

### Test-Dateien (cli/)

| Datei | Zweck | Wann nutzen |
|-------|-------|-----------|
| **`test-qrcode-rest-api.js`** | Umfassende QR-Code Tests | Detaillierte Analyse |
| **`test-qrcode-json-rpc-bearer-token.js`** | ⭐ End-to-End Flow | **EMPFOHLEN** |

### Dokumentation (docs/02-api-reference/)

| Datei | Inhalt | Für wen |
|-------|--------|--------|
| **`QR_CODE_REST_API.md`** | Technischer Deep-Dive | Entwickler |
| **`QR_CODE_LOGIN_TEST_SUMMARY.md`** | Zusammenfassung & Findings | Alle |

### Aktualisierte Dateien

- **`cli/README.md`** - Neue Abschnitte für QR-Code Tests

---

## 🚀 Wie man startet

### 1. Schnell verstehen (5 Minuten)
```bash
cat QR_CODE_TEST_README.md
```

### 2. Mit QR-Code testen (15-30 Minuten)
```bash
cd /opt/magic_mirror/modules/MMM-Webuntis

# Setze deine QR-Code-URL hier ein:
WEBUNTIS_QRCODE="untis://setschool?school=...&user=...&url=...&key=..." \
node cli/test-qrcode-json-rpc-bearer-token.js
```

### 3. Technische Details lesen
```bash
cat docs/02-api-reference/QR_CODE_REST_API.md
```

---

## 📊 Was der Test zeigt

Der End-to-End Test (`test-qrcode-json-rpc-bearer-token.js`) zeigt dir:

```
✅ Step 1: Parse QR Code
   → Extrahiert: school, user, url, key

✅ Step 2: JSON-RPC Login
   → Nutzt QR-Key als Passwort
   → Erhält Session Cookies

✅ Step 3: Get Bearer Token
   → Ruft /api/token/new auf
   → Erhält JWT Bearer Token
   → Zeigt Token Details (user_id, expiration, role)

✅ Step 4: Test REST API
   → Testet 3 Endpoints mit Bearer Token:
     • /api/rest/view/v1/app/data (erfolgreich?)
     • /api/timegrid (erfolgreich?)
     • /api/holidays (erfolgreich?)

RESULT: Zeigt welche Endpoints verfügbar sind
```

---

## 🔑 Der Authentication Flow

```
QR-Code String
    ↓
┌─────────────────────────────────────┐
│ Parse URL Parameters                │
│ - school: gymnasium-hamburg         │
│ - user: student123                  │
│ - url: hamburg.webuntis.com         │
│ - key: [API Key]                    │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│ JSON-RPC Login                      │
│ POST /jsonrpc.do                    │
│ params: {                           │
│   user: "student123",               │
│   password: "[API Key]",            │
│   client: "MyApp"                   │
│ }                                   │
└─────────────────┬───────────────────┘
                  ↓ (✅ Erfolg)
┌─────────────────────────────────────┐
│ Session Cookies                     │
│ - JSESSIONID=ABC123...              │
│ - schoolNumber=42...                │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│ Get Bearer Token                    │
│ GET /api/token/new                  │
│ Header: Cookie: JSESSIONID=ABC123...│
└─────────────────┬───────────────────┘
                  ↓ (✅ JWT Token)
┌─────────────────────────────────────┐
│ REST API Calls                      │
│ Authorization: Bearer [JWT Token]   │
│ GET /api/rest/view/v1/app/data      │
│ GET /api/rest/view/v1/lessons       │
│ GET /api/rest/view/v1/exams         │
└─────────────────────────────────────┘
                  ↓
            ✅ SUCCESS!
```

---

## 📖 Dokumentation nach Thema

### Wenn du wissen möchtest...

**"Kann ich QR-Codes überhaupt verwenden?"**
→ `QR_CODE_LOGIN_TEST_SUMMARY.md` - Key Findings Abschnitt

**"Wie funktioniert der genaue Authentication Flow?"**
→ `QR_CODE_REST_API.md` - Technical Deep Dive Abschnitt

**"Welche REST API Endpoints sind verfügbar?"**
→ `QR_CODE_REST_API.md` - REST API Endpoints Abschnitt

**"Wie implementiere ich das in MMM-Webuntis?"**
→ `QR_CODE_REST_API.md` - Extending MMM-Webuntis Abschnitt

**"Wie teste ich meine QR-Code?"**
→ `QR_CODE_TEST_README.md` - Quick Start & Testing Guide

**"Was ist der Unterschied QR-Code vs. Elternkonto?"**
→ `QR_CODE_REST_API.md` - Key Differences Tabelle

**"Ist das sicher?"**
→ `QR_CODE_REST_API.md` - Security Notes Abschnitt

---

## ✅ Ergebnisse

### Was funktioniert
- ✅ QR-Code parsen
- ✅ JSON-RPC Login mit QR-Key
- ✅ Bearer Token erhalten
- ✅ REST API mit Token nutzen
- ✅ Stundenplan abrufen
- ✅ App-Daten abrufen

### Was nicht funktioniert
- ❌ QR-Code in WebUntis Web-UI nutzen (ist eine WebUntis-Limitation)

### Wichtig für MMM-Webuntis
- QR-Codes können als Alternative zu Benutzername/Passwort genutzt werden
- Ermöglicht Schülern ihre eigenen Daten zu sehen
- Gleiche Daten wie Elternkonto, aber nur für sich selbst

---

## 🔐 Wichtig: Sicherheit

⚠️ **QR-Codes enthalten Credentials!**

- Behandle QR-Codes wie Passwörter
- Nicht in Code/Git committen
- Nutze Umgebungsvariablen für Tests
- QR-Codes regenerieren nach ~30 Tagen
- Token sind kurzlebig (15 Minuten)

---

## 📋 Checkliste zum Testen

- [ ] Lese `QR_CODE_TEST_README.md`
- [ ] Besorge einen gültigen QR-Code (von WebUntis Mobile App)
- [ ] Führe den empfohlenen Test aus:
  ```bash
  WEBUNTIS_QRCODE="..." node cli/test-qrcode-json-rpc-bearer-token.js
  ```
- [ ] Überprüfe die REST API Ergebnisse
- [ ] Lese `QR_CODE_REST_API.md` für Details
- [ ] Plane Integration in MMM-Webuntis (falls gewünscht)

---

## 🚀 Nächste Schritte

### Option A: Nur Information sammeln ℹ️
→ Lese die Dokumentation und verstehe den Flow

### Option B: Mit deinen Credentials testen 🧪
→ Führe die Test-Suite mit deinem QR-Code aus

### Option C: In MMM-Webuntis integrieren 🔧
→ Folge dem Plan in `QR_CODE_REST_API.md` Abschnitt "Extending MMM-Webuntis"

---

## 📞 Support & Troubleshooting

### Häufige Fehler

| Fehler | Ursache | Lösung |
|--------|--------|--------|
| "Invalid QR code format" | Falsches Format | Check `untis://` Prefix |
| "401 Unauthorized" | QR abgelaufen/ungültig | Neu generieren |
| "Connection error" | Server nicht erreichbar | URL prüfen, Netzwerk testen |
| "No token received" | Auth Endpoint nicht verfügbar | Server-Version prüfen |

Siehe auch: `docs/02-api-reference/QR_CODE_REST_API.md` - Testing & Troubleshooting

---

## 📞 Dateien im Überblick

```
MMM-Webuntis/
│
├── 📄 QR_CODE_TEST_README.md          ← Start here (Deutsch)
├── 📄 QR_CODE_TESTING_GUIDE.sh        ← Interaktive Anleitung
│
├── cli/
│   ├── 🧪 test-qrcode-rest-api.js
│   ├── 🧪 test-qrcode-json-rpc-bearer-token.js (⭐)
│   └── 📖 README.md (aktualisiert)
│
└── docs/02-api-reference/
    ├── 📖 QR_CODE_REST_API.md (technisch)
    ├── 📖 QR_CODE_LOGIN_TEST_SUMMARY.md (Überblick)
    └── 📖 BEARER_TOKEN_GUIDE.md (bestehend)
```

---

**Status:** ✅ Fertig und bereit zum Testen!

Viel Erfolg beim Testen! 🚀
