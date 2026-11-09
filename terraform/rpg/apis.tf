/*
 * The APIs the game's backend needs. Not imported, for the reason in terraform/apis.tf: enabling
 * an enabled service is a no-op, so the list may err towards too many.
 */
locals {
  services = [
    # Firebase, and what the game keeps in it: accounts, worlds and saves.
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",

    # The functions (`rpgDemo`, `rpgApi`, `rpgJob`) and their build pipeline.
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    # `rpgProposals`, the menu's proposed worlds once a day.
    "cloudscheduler.googleapis.com",

    # Workload Identity Federation, how CI gets in without a key.
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = local.project_id
  service = each.value

  # Turning an API off in a live project takes its resources with it. Never on a `destroy`.
  disable_on_destroy         = false
  disable_dependent_services = false
}

/*
 * Makes korczak-rpg a Firebase project. Idempotent from the API's side only in the sense that a
 * second addFirebase fails, so if the console's "Add Firebase" was used first, import it:
 *   terraform import google_firebase_project.this projects/korczak-rpg
 */
resource "google_firebase_project" "this" {
  provider = google-beta
  project  = local.project_id

  depends_on = [google_project_service.enabled]
}
