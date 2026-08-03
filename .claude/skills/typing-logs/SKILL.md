---
name: typing-logs
description: Use when investigating typing trainer issues from the browser console - the window.typingLogs API for reading, searching, and flushing the structured frontend log buffer, including the progress.revert.detected and progress.stale.detected assertions.
---

# Typing Trainer — Frontend Logging

Structured logs buffer in localStorage and upload in batches to `users/{uid}/logs`. They keep
buffering while signed out and flush once a user resolves.

```javascript
typingLogs.show(40)     // print the last n entries
typingLogs.find('sync') // entries whose event name contains a string
typingLogs.dump()       // the whole buffer
typingLogs.flush()      // upload now (needs sign-in + network)
typingLogs.verbose()    // mirror new entries to the console (persists)
typingLogs.info()       // client id, page id, uid, buffered count
typingLogs.help()
```

## Assertions worth searching for

Two `error`-level entries fire when progress goes backwards. `typingLogs.find('progress.')`
surfaces both:

- `progress.revert.detected` — progress moved backwards mid-session by more than a single-section
  backspace. Carries before/after snapshots and the sync status at the time.
- `progress.stale.detected` — the record loaded at mount already sits behind its own sync
  bookmark. Carries the loaded record, the bookmark and `storageBytes()`; a `storageBytes()` near
  the ~5 MB origin quota is usually the explanation, and `storage.write.failed` will be in the
  buffer too.
