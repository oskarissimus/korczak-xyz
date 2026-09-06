/*
 * Scheduled backups for the one thing here that cannot be regenerated.
 *
 * Most of what is in Firestore is derived and would come back on its own: `events`, `transitItems`
 * and `transitRaw` are rebuilt by the next collector run, `eventSources` and `transitFeeds` are
 * health rows about that run. Delete them and the worst case is a quiet feed for an hour.
 *
 * `users/{uid}/babySleep` and its siblings are not that. They are typed in by hand, at night, one
 * entry at a time, and nothing anywhere else in the system knows what they said. A bad client
 * write, a rule regression, or a fat-fingered console delete takes them and there is no second
 * copy. That asymmetry is the whole reason this file exists — the cost below is being paid for the
 * sleep log, and everything else is along for the ride.
 *
 * WHAT THIS IS NOT. It is not point-in-time recovery. PITR is a property of the DATABASE, and the
 * database resource is deliberately not declared here: `google_firestore_database` describes the
 * thing every other tool in this project reads and writes, and adopting it into Terraform to flip
 * one boolean would put the ownership line in main.tf at risk for a feature with a seven-day window
 * and a continuous bill. A backup schedule is a separate resource that touches nothing else, which
 * is why it is the piece that got written.
 *
 * The granularity is therefore a day, not a minute. Restoring loses everything since the last
 * backup, and restore creates a NEW database rather than overwriting `(default)` — so recovery is
 * a deliberate operation somebody performs, not something that happens automatically.
 */

/*
 * The retention numbers are not free choices — the API caps them, and picking past the cap fails
 * the apply rather than quietly clamping:
 *
 *   daily   at most 7 days
 *   weekly  at most 14 weeks
 *
 * One schedule of each kind per database is also the maximum, so this file cannot grow a third.
 *
 * Both carry `prevent_destroy` for a reason that is easy to miss: deleting a backup schedule
 * deletes the backups it created. A plan that removes one of these is not "stop taking backups from
 * now on", it is "and also throw away the ones you have" — which is the shape of mistake that is
 * only noticed on the day it matters.
 */
resource "google_firestore_backup_schedule" "daily" {
  project   = local.project_id
  database  = "(default)"
  retention = "604800s" # 7 days, the maximum for a daily schedule

  daily_recurrence {}

  lifecycle {
    prevent_destroy = true
  }
}

/*
 * The weekly one is what covers slow damage. A daily schedule only answers "undo the last week";
 * a corruption that arrives quietly — a rule that has been letting the wrong writes through, a
 * client bug rewriting old entries — is usually noticed long after seven days have rolled past.
 */
resource "google_firestore_backup_schedule" "weekly" {
  project   = local.project_id
  database  = "(default)"
  retention = "8467200s" # 14 weeks, the maximum

  weekly_recurrence {
    day = "SUNDAY"
  }

  lifecycle {
    prevent_destroy = true
  }
}
