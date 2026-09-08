/*
 * A copy of Firestore that leaves Google.
 *
 * WHY THIS EXISTS ALONGSIDE firestore.tf, WHICH ALREADY SAYS "BACKUP":
 *
 * A scheduled backup and an export are different features that protect against different things,
 * and the names actively mislead. Backups live in Firestore-managed storage — there is no object,
 * no bucket, and nothing outside the Firestore API can see or fetch one. They are excellent
 * against *our own* mistakes: a bad client write, a rules regression, a console delete.
 *
 * They are worth nothing against losing the Google account. A suspended project takes the database
 * and every backup of it in the same movement, because they are the same vendor and, as far as any
 * of this is concerned, the same object.
 *
 * An export is the other half: real files, in a bucket, in a format that leaves. That is why the
 * pipeline below exists even though backups are already running.
 *
 *   firestore.tf         undo a mistake            7 days / 14 weeks, restore = a NEW database
 *   this file            survive losing Google     a nightly folder of files, fetchable offsite
 *
 * NO CLOUD FUNCTION. Cloud Scheduler calls the Firestore Admin API directly with an OAuth token —
 * the export is a single POST, and wrapping it in a function would add a deploy, a runtime and a
 * language to something with no logic in it.
 */

locals {
  export_bucket = "${local.project_id}-firestore-export"
}

/*
 * Where the exports land.
 *
 * NOT versioned, deliberately, unlike the state bucket: every run writes a new timestamped folder
 * and nothing is ever overwritten, so versioning would only pay to keep copies of files that never
 * change. The lifecycle rule below is what bounds the cost instead.
 */
resource "google_storage_bucket" "firestore_export" {
  project  = local.project_id
  name     = local.export_bucket
  location = local.region

  /* No ACLs. The only grants on this bucket are the two IAM members below. */
  uniform_bucket_level_access = true

  /*
   * 30 days of nightly full exports. This database is small enough that the number is about
   * tidiness rather than money, but an unbounded bucket of daily full copies is how a hobby
   * project grows a bill nobody looks at.
   *
   * It is longer than the offsite pull interval by a wide margin ON PURPOSE: if that pull stops
   * working, this is how many days you have to notice before the only copies are the ones inside
   * Google again.
   */
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  /*
   * Deleting this bucket deletes every export in it, and the whole point of the bucket is to be
   * the copy that is not inside Firestore. The workflow's "no plan may destroy anything" gate
   * covers this too; this is the second lock.
   */
  lifecycle {
    prevent_destroy = true
  }
}

/*
 * The identity that ASKS for an export. It does not write the files — Firestore's own service
 * agent does that — it only holds the button.
 */
resource "google_service_account" "firestore_export" {
  project      = local.project_id
  account_id   = "firestore-export"
  display_name = "Scheduled Firestore exports"
  description  = "Used by Cloud Scheduler to call firestore:exportDocuments. Managed in terraform/firestore-export.tf."
}

resource "google_project_iam_member" "firestore_export_admin" {
  project = local.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.firestore_export.email}"
}

/*
 * Cloud Scheduler does not hold the export account's credentials — it asks IAM to mint a token as
 * that account, and it is allowed to do that only because of this grant. Without it the job is
 * created happily and then fails at 03:30 with a permission error nobody is awake for.
 */
resource "google_service_account_iam_member" "scheduler_mints_export_token" {
  service_account_id = google_service_account.firestore_export.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

/*
 * The account that actually writes the export files is Firestore's service agent, not the caller
 * above. For a bucket in the same project this often works without being said out loud — which is
 * exactly why it is said out loud here. An implicit permission is one that changes without a
 * commit.
 */
resource "google_storage_bucket_iam_member" "firestore_agent_writes" {
  bucket = google_storage_bucket.firestore_export.name
  role   = "roles/storage.admin"
  member = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-firestore.iam.gserviceaccount.com"
}

/*
 * The offsite reader.
 *
 * A separate account whose entire authority is "read the objects in one bucket", because its key
 * is a FILE ON A MACHINE THIS PROJECT DOES NOT CONTROL. That is the opposite of the deploy
 * account, whose key would be a projectIamAdmin credential — the right to grant itself anything.
 *
 * THE KEY IS NOT IN TERRAFORM, and must not be. `google_service_account_key` puts the private key
 * in state in the clear, which is the same rule that keeps VAPID_PRIVATE_KEY out — see the header
 * of main.tf. Mint it by hand, once, with
 * `gcloud iam service-accounts keys create`, install it wherever it is needed, and delete the
 * local copy.
 */
resource "google_service_account" "nas_backup_reader" {
  project      = local.project_id
  account_id   = "nas-backup-reader"
  display_name = "Export bucket read-only puller"
  description  = "Read-only on the export bucket. Its key is held offsite. Managed in terraform/firestore-export.tf."
}

resource "google_storage_bucket_iam_member" "nas_reads_exports" {
  bucket = google_storage_bucket.firestore_export.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.nas_backup_reader.email}"
}

/*
 * objectViewer covers the objects but not the bucket itself, and a client that calls buckets.get
 * before listing needs this too. Without it the connection tests fine and then shows an empty
 * list, which reads as "nothing there" rather than as a permission problem.
 */
resource "google_storage_bucket_iam_member" "nas_reads_bucket" {
  bucket = google_storage_bucket.firestore_export.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.nas_backup_reader.email}"
}

/*
 * 03:30 Warsaw, nightly.
 *
 * THE BODY IS THE SUBTLE PART. `outputUriPrefix` is the bare bucket with no path, and that is not
 * laziness: given a bucket alone the API generates a folder named for the export's start time, so
 * every run is its own immutable directory. Add a path here and every night writes over the same
 * prefix, which turns thirty days of history into one folder and the lifecycle rule into a
 * countdown on the only copy.
 *
 * No `collectionIds`, so it takes everything — including users/{uid}/babySleep, which is the
 * reason any of this was built.
 */
resource "google_cloud_scheduler_job" "firestore_export" {
  project     = local.project_id
  region      = local.region
  name        = "firestore-nightly-export"
  description = "Full Firestore export to gs://${local.export_bucket}."
  schedule    = "30 3 * * *"
  time_zone   = "Europe/Warsaw"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "https://firestore.googleapis.com/v1/projects/${local.project_id}/databases/(default):exportDocuments"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      outputUriPrefix = "gs://${local.export_bucket}"
    }))

    oauth_token {
      service_account_email = google_service_account.firestore_export.email
    }
  }
}
