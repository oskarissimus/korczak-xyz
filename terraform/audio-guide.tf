/*
 * Where the audio guide keeps a record of what it said.
 *
 * Every tap the model answers leaves one JSON object here: the place, the sources the facts were
 * drawn from in full, every fact the model proposed, the ones that survived the quote check, and
 * the script that was read aloud. It exists for fact-checking afterwards — reading a script back
 * against the text it claims to come from — which the check at generation time cannot do. See
 * audio-guide-function/record.go.
 *
 * NOT A FIREBASE BUCKET, unlike the sloper one in storage.tf. Nothing in the browser reads it, so
 * it has no `google_firebase_storage_bucket`, no `storage.rules` and no CORS. The only writer is
 * `generate-audio`, as its runtime identity; the only readers are people with project access,
 * with `gcloud storage cat` or a script.
 *
 * The function learns the name from `GUIDE_RECORDS_BUCKET`, which the audio-guide job in
 * firebase-deploy.yml sets from the same `<project>-audio-guide-records` pattern. That job runs
 * after this one, so the bucket and the grant below exist before the first deploy that writes to
 * them — a single-pass landing.
 */

resource "google_storage_bucket" "audio_guide_records" {
  project  = local.project_id
  name     = "${local.project_id}-audio-guide-records"
  location = local.region

  uniform_bucket_level_access = true

  /*
   * The records hold nobody's keys and no account id, but they do hold where a guide was asked
   * for, which over a few weeks is a walk. No link to one should ever work.
   */
  public_access_prevention = "enforced"

  /*
   * NO DELETE RULE. The point is analysis over time — whether a prompt change made the scripts
   * more faithful is a before-and-after question, and the "before" must still exist. A record is
   * tens of kilobytes (the sources are capped in sources.go), so a thousand taps is tens of
   * megabytes: nothing a timer needs to protect the bill from.
   *
   * Nearline after 30 days, because a record is read in the week it is made or in a batch months
   * later, and that is the shape Nearline is priced for.
   */
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  /*
   * Deleting this bucket deletes every record. The workflow's "no plan may destroy anything" gate
   * covers it too; this is the second lock, as on the other two buckets.
   */
  lifecycle {
    prevent_destroy = true
  }
}

/*
 * What lets `generate-audio` write a record, and nothing more.
 *
 * `objectCreator`, not `objectAdmin`: create, never read, overwrite or delete. The function is
 * public — anybody may post to it — so the identity it runs as is the one worth keeping narrowest;
 * at worst a stranger can add records, never change or remove the ones there.
 *
 * The identity is the default compute account (`functions_runtime_sa` in main.tf), because the
 * gcloud deploy sets no `--service-account`, exactly as the Node functions' firebase.json sets
 * none. Give it one and this grant must follow it.
 */
resource "google_storage_bucket_iam_member" "audio_guide_writes_records" {
  bucket = google_storage_bucket.audio_guide_records.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${local.functions_runtime_sa}"
}

/*
 * How each tap ended, as a number over time: one count per POST to generate-audio, labelled by
 * `outcome` (narrated, no_sources, no_verified_facts, ...) and the pin's `category`. It is read off
 * the `generate-audio.timing` line timing.go writes for every POST, so it needs nothing from the
 * function and covers the 422s that never reach a model. Metrics Explorer →
 * logging/user/audio_guide_taps, grouped by outcome, is the share of pins with nothing written
 * about them. The records above say which places; this says how many.
 *
 * Needs `roles/logging.configWriter` on the deploy account, granted in iam.tf.
 */
resource "google_logging_metric" "audio_guide_taps" {
  project = local.project_id
  name    = "audio_guide_taps"
  filter  = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="generate-audio"
    jsonPayload.event="generate-audio.timing"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Audio guide taps"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
    labels {
      key        = "category"
      value_type = "STRING"
    }
  }

  label_extractors = {
    outcome  = "EXTRACT(jsonPayload.outcome)"
    category = "EXTRACT(jsonPayload.category)"
  }

  depends_on = [google_project_iam_member.deployer_log_metrics]
}
