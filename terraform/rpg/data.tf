/*
 * What the game keeps and who may sign in: the game's own database, accounts and bucket, so nothing
 * on rpg.korczak.xyz is shared with korczak.xyz. Rules and functions are not here — the release
 * workflow deploys those with the Firebase CLI, the same ownership line as terraform/README.md.
 */

/*
 * The database. In the site's project nothing owns it (see terraform/firestore.tf), because it
 * predates Terraform; here Terraform makes it, so here Terraform owns it. ABANDON plus
 * prevent_destroy: no apply may ever delete a database, and the workflow refuses a plan that tries.
 */
resource "google_firestore_database" "default" {
  project         = local.project_id
  name            = "(default)"
  location_id     = local.region
  type            = "FIRESTORE_NATIVE"
  deletion_policy = "ABANDON"

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

/*
 * Accounts: email and password, as on the site, with self-service sign-up on and the approval
 * gate in firestore.rules (.claude/rules/accounts.md).
 *
 * In the site's project this is a console setting on purpose — the resource fights an Identity
 * Platform that is already initialised. Here nothing was initialised before this file, so the
 * create is the initialisation and there is nothing to fight.
 */
resource "google_identity_platform_config" "auth" {
  project = local.project_id

  authorized_domains = [
    "localhost",
    "${local.project_id}.firebaseapp.com",
    "${local.project_id}.web.app",
    "rpg.korczak.xyz",
  ]

  sign_in {
    allow_duplicate_emails = false
    email {
      enabled           = true
      password_required = true
    }
  }

  depends_on = [google_firebase_project.this]
}

# The web app whose config .env.rpg carries. Printed by the workflow's `terraform output`.
resource "google_firebase_web_app" "rpg" {
  provider        = google-beta
  project         = local.project_id
  display_name    = "rpg.korczak.xyz"
  deletion_policy = "ABANDON"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "rpg" {
  provider   = google-beta
  project    = local.project_id
  web_app_id = google_firebase_web_app.rpg.app_id
}

/*
 * Every asset the game pays a provider for, as `korczak-xyz-501720-rpg` is for the site (see that
 * bucket in terraform/storage.tf for the whole argument). Named `<project>-rpg` because
 * functions/src/runtime.ts derives it that way. Written only by the functions on the Admin SDK and
 * read by download-token URL, so no storage.rules are deployed to it.
 */
resource "google_storage_bucket" "assets" {
  project  = local.project_id
  name     = "${local.project_id}-rpg"
  location = local.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  cors {
    origin = [
      "https://rpg.korczak.xyz",
      # `astro dev` and `astro preview`.
      "http://localhost:4321",
      "http://localhost:4322",
    ]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

# Without this the download-token URLs (firebasestorage.googleapis.com) answer 404.
resource "google_firebase_storage_bucket" "assets" {
  provider  = google-beta
  project   = local.project_id
  bucket_id = google_storage_bucket.assets.name
}

/*
 * The SkinTokens service stays in the site's project and is shared: it is stateless compute on a
 * 2.3 GB model, and a second copy would be a second image build and a second cold start for the
 * same answer. The game's functions run as this project's default compute account, which is let in
 * here. Applied with the site deployer's run.admin on korczak-xyz-501720.
 */
resource "google_cloud_run_v2_service_iam_member" "skin_weights_from_rpg" {
  project  = "korczak-xyz-501720"
  location = local.region
  name     = "skin-weights"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}
