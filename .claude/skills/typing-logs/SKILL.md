---
name: typing-logs
description: Use when investigating typing trainer issues - the window.typingLogs console API for reading and searching the in-memory frontend log tail, how the same entries reach Sentry, and the progress.revert.detected and progress.stale.detected assertions.
---

# Typing Trainer — Frontend Logging

Structured entries go to **Sentry** (project `korczak-xyz`, org `oskar-korczak`, EU region —
`https://oskar-korczak.sentry.io`). `window.typingLogs` reads a short in-memory tail of the same
entries, for watching them go by while reproducing something.

The two destinations do not carry the same thing, and this is the part to get right before
concluding a log is missing:

| Level | Sentry | `typingLogs` tail |
|---|---|---|
| `debug`, `info`, `warn` | breadcrumb — attached to the **next** event, invisible if nothing fails | yes |
| `error` | its own Sentry issue, fingerprinted on the event name | yes |

So a `log.warn` that reached nothing in Sentry is working as designed. Search the tail for it
instead, or make the failure happen and read the breadcrumbs on the resulting issue.

```javascript
typingLogs.show(40)     // print the last n entries
typingLogs.find('sync') // entries whose event name contains a string
typingLogs.dump()       // the whole tail — in memory, max 200, gone on reload
typingLogs.flush()      // wait for queued Sentry events to send (before closing the tab)
typingLogs.verbose()    // mirror new entries to the console (persists)
typingLogs.info()       // client id, page id, uid, tail size, whether Sentry initialised
typingLogs.help()
```

`typingLogs.info().sentry === false` means the SDK never initialised — an ad blocker is the
usual reason, and it means nothing from that session reached Sentry however healthy the tail
looks.

## Finding a session in Sentry

Entries are not tagged by app, so search by what identifies the run:

- `client_id` — a tag on every event, stable per browser profile. The same value
  `typingLogs.info().clientId` prints, so a report that includes it locates the session exactly.
- `user.id` — the Firebase uid, set once signed in.
- `log_event` — a tag carrying the dotted event name on `error` events, e.g.
  `log_event:progress.stale.detected`.
- `release` — the short commit hash, the same string the navbar's status bar links to.

## Assertions worth searching for

Two `error`-level entries fire when progress goes backwards, so both are Sentry issues in their
own right. `typingLogs.find('progress.')` surfaces them locally:

- `progress.revert.detected` — progress moved backwards mid-session by more than a single-section
  backspace. Carries before/after snapshots and the sync status at the time.
- `progress.stale.detected` — the record loaded at mount already sits behind its own sync
  bookmark. Carries the loaded record, the bookmark and `storageBytes()`; a `storageBytes()` near
  the ~5 MB origin quota is usually the explanation, and `storage.write.failed` will be among the
  breadcrumbs on the same issue.
