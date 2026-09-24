/*
 * The audio guide's pins, built weekly for the whole world and served as one static file.
 *
 * The map used to ask Overpass - free, shared, rate-limited - for the pins in every rectangle it
 * had not seen, and waited seconds to tens of seconds for each answer. This is the replacement:
 * once a week a spot VM downloads the OpenStreetMap planet, keeps only the places the app would
 * have asked Overpass for, and writes them into one PMTiles archive in the bucket below. The
 * browser reads the tile it needs with a range request. See audio-guide-pins/build.py for the
 * build and `.claude/rules/audio-guide.md` for the app's side.
 *
 * THREE PIECES, AND NO FUNCTION:
 *
 *   Cloud Scheduler   every Saturday, POSTs a job to the Batch API as `pins-trigger@`
 *   Cloud Batch       runs it on a spot VM as `pins-builder@`, retries it if the VM is taken back
 *   this bucket       where the archive and `latest.json` land, public to read
 *
 * The same shape as firestore-export.tf: the scheduler calls a Google API directly with an OAuth
 * token, because wrapping one POST in a function would add a deploy and a runtime to something
 * with no logic in it.
 *
 * THE JOB CARRIES ITS OWN CODE. build.py, its requirements and the app's storyTags.json are
 * base64'd into the job's environment from this repository, so what runs on Saturday is what was
 * on main at the last apply. That is also why the deploy workflow's path filter lists
 * `audio-guide-pins/**` and storyTags.json: a change to either has to reach this job to matter.
 *
 * WHAT IT COSTS, roughly: a spot e2-highmem-4 and a 250 GB SSD for about an hour and a half a
 * week - a dollar a month - and the bucket's storage and egress, which at this site's traffic
 * are cents. A failed build costs nothing but a Sentry issue and a week-older map.
 */

locals {
  pins_bucket = "${local.project_id}-audio-guide-pins"

  # A content hash rather than the commit: the scheduler job is rewritten whenever this changes,
  # and a commit hash would change it on every push. The hash only moves when the builder does.
  pins_release = "pins-${substr(filesha256("${path.module}/../audio-guide-pins/build.py"), 0, 10)}"
}

/*
 * Public to read, by design: the archive is OpenStreetMap data, which is public already, and the
 * browser reads it anonymously with range requests. Everything a visitor can fetch here, they
 * could have asked Overpass for.
 *
 * NOT behind korczak.xyz. The site is a Cloudflare Worker with nothing but static assets, whose
 * per-file limit is far below a world archive, and giving it a `main` to proxy this would take
 * every page out from under `_headers` (see wrangler.jsonc). GCS answers range requests directly.
 */
resource "google_storage_bucket" "audio_guide_pins" {
  project  = local.project_id
  name     = local.pins_bucket
  location = local.region

  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"

  /*
   * What lets a page on another origin read ranges out of the archive. `Range` is named because
   * not every browser treats it as a safelisted header, and without it here the preflight fails
   * and so does every tile. `Content-Range` and `ETag` must be readable by the page: the PMTiles
   * reader checks both, to tell a range answer from a whole file and to notice a changed archive.
   *
   * `*` as the origin because the data is public and a CORS rule is not access control - curl
   * never sends an Origin. Listing korczak.xyz alone would only break the workers.dev preview
   * and `astro dev`.
   */
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range", "Range", "ETag", "Cache-Control"]
    max_age_seconds = 3600
  }

  /*
   * No lifecycle rule. The builder deletes every archive but the newest two itself, by name, after
   * it has switched `latest.json` over. An age rule would do the same in the good weeks and, after
   * a month of failed builds, delete the only archive there is.
   */
}

resource "google_storage_bucket_iam_member" "audio_guide_pins_public" {
  bucket = google_storage_bucket.audio_guide_pins.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

/*
 * What the build runs as. It downloads the planet, which needs nothing, and writes to the bucket
 * above, which needs objectAdmin there - create, list and delete, for the pruning - and nothing
 * anywhere else. The two project roles are what Batch requires of any job's identity: reporting
 * the VM's state back to Batch, and writing its log to Cloud Logging.
 */
resource "google_service_account" "pins_builder" {
  project      = local.project_id
  account_id   = "pins-builder"
  display_name = "Audio guide pins build"
  description  = "The weekly Cloud Batch job that builds the audio guide's pins. Managed in terraform/audio-guide-pins.tf."
}

resource "google_storage_bucket_iam_member" "pins_builder_writes" {
  bucket = google_storage_bucket.audio_guide_pins.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.pins_builder.email}"
}

resource "google_project_iam_member" "pins_builder_batch_agent" {
  project = local.project_id
  role    = "roles/batch.agentReporter"
  member  = "serviceAccount:${google_service_account.pins_builder.email}"
}

resource "google_project_iam_member" "pins_builder_logs" {
  project = local.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.pins_builder.email}"
}

/*
 * The identity that PRESSES THE BUTTON: creates a Batch job, and may hand that job the builder's
 * identity. Kept apart from the builder so that the thing running arbitrary downloaded input
 * cannot create jobs, and the thing that can create jobs never holds the bucket.
 */
resource "google_service_account" "pins_trigger" {
  project      = local.project_id
  account_id   = "pins-trigger"
  display_name = "Audio guide pins schedule"
  description  = "Used by Cloud Scheduler to create the weekly pins Batch job. Managed in terraform/audio-guide-pins.tf."
}

resource "google_project_iam_member" "pins_trigger_creates_jobs" {
  project = local.project_id
  role    = "roles/batch.jobsEditor"
  member  = "serviceAccount:${google_service_account.pins_trigger.email}"
}

resource "google_service_account_iam_member" "pins_trigger_acts_as_builder" {
  service_account_id = google_service_account.pins_builder.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.pins_trigger.email}"
}

/* Without this the job is created happily and then fails on Saturday morning - see the same grant
 * in firestore-export.tf. */
resource "google_service_account_iam_member" "scheduler_mints_pins_token" {
  service_account_id = google_service_account.pins_trigger.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

/*
 * Saturday 04:07 Warsaw. The planet is published once a week, dated Monday and usually on the
 * mirrors by Thursday, so Saturday reads the newest one with a day to spare.
 *
 * No `jobId` in the URI: Batch names each job itself, and a fixed name would fail every week
 * after the first because finished jobs are kept.
 *
 * `retry_config` is the SCHEDULER's retry of the POST, not of the build. A build is retried by
 * Batch, and only when the spot VM was taken back (exit code 50001); a build that failed on its
 * own terms has already reported itself to Sentry and would only fail again.
 */
resource "google_cloud_scheduler_job" "audio_guide_pins" {
  project     = local.project_id
  region      = local.region
  name        = "audio-guide-pins-weekly"
  description = "Weekly world build of the audio guide's pins into gs://${local.pins_bucket}."
  schedule    = "7 4 * * 6"
  time_zone   = "Europe/Warsaw"

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "https://batch.googleapis.com/v1/projects/${local.project_id}/locations/${local.region}/jobs"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode(jsonencode({
      labels = { app = "audio-guide-pins" }

      taskGroups = [{
        taskCount = 1
        taskSpec = {
          runnables = [{
            container = {
              # Docker Hub's image through Google's mirror of it, because an anonymous pull from
              # Docker Hub is rate limited per IP and a 429 on Saturday morning is a lost week.
              imageUri   = "mirror.gcr.io/library/python:3.12-slim-bookworm"
              entrypoint = "/bin/bash"
              commands   = ["-c", "echo \"$PINS_RUN_SH\" | base64 -d > /run.sh && exec bash /run.sh"]
            }
          }]

          # The whole machine: one task, one VM.
          computeResource = {
            cpuMilli  = 4000
            memoryMib = 28000
          }

          # A full run is about an hour and a half. Six is a ceiling on a hung download, not an
          # estimate.
          maxRunDuration = "21600s"
          maxRetryCount  = 3
          lifecyclePolicies = [
            { action = "RETRY_TASK", actionCondition = { exitCodes = [50001] } },
            { action = "FAIL_TASK", actionCondition = { exitCodes = [1] } },
          ]

          environment = {
            variables = {
              PINS_RUN_SH       = filebase64("${path.module}/../audio-guide-pins/run.sh")
              PINS_BUILD_PY     = filebase64("${path.module}/../audio-guide-pins/build.py")
              PINS_REQUIREMENTS = filebase64("${path.module}/../audio-guide-pins/requirements.txt")
              PINS_STORY_TAGS   = filebase64("${path.module}/../korczak-xyz/src/utils/audioGuide/storyTags.json")
              PINS_BUCKET       = local.pins_bucket
              PINS_RELEASE      = local.pins_release
              # The world has millions of these places. A build that finds fewer than this is a
              # truncated planet or a broken filter, and publishing it would empty the map
              # everywhere at once - so it fails instead, and the old archive stays.
              PINS_MIN_PLACES = "500000"
            }
          }
        }
      }]

      allocationPolicy = {
        location = { allowedLocations = ["regions/${local.region}"] }
        instances = [{
          policy = {
            # Memory rather than cores: osmium's filter is mostly reading, and the node-location
            # index and the tiles being filed are what the machine has to hold.
            machineType       = "e2-highmem-4"
            provisioningModel = "SPOT"
            # SSD for its baseline throughput: the planet is read three times by the filter, and
            # a balanced disk's ~140 MB/s turns each pass into a quarter of an hour.
            bootDisk = {
              type   = "pd-ssd"
              sizeGb = 250
            }
          }
        }]
        serviceAccount = { email = google_service_account.pins_builder.email }
      }

      logsPolicy = { destination = "CLOUD_LOGGING" }
    }))

    oauth_token {
      service_account_email = google_service_account.pins_trigger.email
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.pins_trigger_creates_jobs,
    google_service_account_iam_member.pins_trigger_acts_as_builder,
  ]
}
