# Security Policy

## Supported versions

Only the latest release on `master` receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately through GitHub:
**Security → Report a vulnerability** on
[this repository](https://github.com/HeikoGr/MMM-Webuntis/security/advisories/new).

Include what an attacker can reach (the mirror's web port, the local machine, the WebUntis account),
the steps to reproduce and the module version. Never attach your `config.js`, a QR code, passwords or
unredacted logs and debug dumps - they contain children's personal data.

You will get an answer within two weeks. Fixes are released as a patch version, and the advisory is
published once a fixed version is available.

## Sensitive data the module handles

- WebUntis passwords and QR codes (the QR code's `key` is a permanent login secret)
- names, timetables, exams, homework, absences and messages of the students

See [Authentication](https://github.com/HeikoGr/MMM-Webuntis/wiki/Authentication#keeping-credentials-safe)
in the wiki for how to run the mirror safely.
