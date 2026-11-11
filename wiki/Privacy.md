# Privacy

MMM-Webuntis handles school data of children: names, timetables, exams, homework, absences and
messages. This page lists where that data ends up, so you can decide what to share when asking for
help.

## Where the data lives

| Place | What | How long |
| --- | --- | --- |
| Memory of the MagicMirror process | the latest fetched data per student | until the next fetch or a restart |
| Browser of each display | what the widgets show | until the page reloads |
| PM2 / MagicMirror log | log lines are prefixed with the student's `title`; at `debug` level they also count lessons, exams and so on | as long as your log rotation keeps them |
| `.debug_dumps/` in the module folder | full payloads, only with `dumpBackendPayloads` or `dumpRawApiResponses` | the newest 25 payload dumps and 50 raw dumps are kept |

Nothing else is stored on disk. Passwords and QR codes are removed from every log line, warning and
dump; see [Authentication](Authentication) for how to keep them out of the browser as well.

The dump folder starts with a dot because MagicMirror serves the whole `modules/` folder over HTTP
and skips only such paths. Files in it are readable by the owner only. Versions up to 0.15.9 wrote to
`debug_dumps/`, which other devices in your network could download; the module moves that folder on
its first start after the update.

## Before you share a dump or a log

- Turn the dump options off again once you have what you need.
- Share only the part that shows the problem, for example the `state` block of a payload dump.
- Replace names (`title`, `studentName`, teacher names), class names and message texts with
  placeholders.
- Check the file for anything that looks like a password, a session cookie or an `untis://` URL
  before attaching it to an issue. GitHub issues are public.
