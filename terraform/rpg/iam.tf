/*
 * Who may act on the game's production. `_member` only, never `_binding` or `_policy` — see the
 * header of terraform/iam.tf for why that is the one safe choice.
 */

# The project's own deployer: what the release workflow will run as.
resource "google_service_account" "deployer" {
  project      = local.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer (RPG production)"

  depends_on = [google_project_service.enabled]
}

locals {
  # The site deployer's roles in korczak-xyz-501720. Everything `firebase deploy` and the apply of
  # this directory need. Cloud Scheduler was left out until the game had a schedule of its own:
  # `rpgProposals`, the menu's proposed worlds once a day (9 Nov 2026), whose deploy writes its job.
  deployer_roles = [
    "roles/firebase.admin",
    "roles/cloudfunctions.admin",
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/iam.serviceAccountAdmin",
    "roles/artifactregistry.admin",
    "roles/cloudbuild.builds.editor",
    "roles/secretmanager.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/storage.admin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/logging.configWriter",
    "roles/cloudscheduler.admin",
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)

  project = local.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = local.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub"

  depends_on = [google_project_service.enabled]
}

/*
 * The security boundary is the attribute condition. The site's pool pins only the repository;
 * this one also pins the environment, so a token from a push to main, a pull request, or any job
 * not declaring `environment: rpg-production` is refused at the exchange.
 */
resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = local.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
  }
  attribute_condition = "assertion.repository == '${local.repository}' && assertion.environment == '${local.environment}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_from_github" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${local.environment}"
}

/*
 * The owner's GCP connector in the Claude app (the same grant korczak-xyz-501720 has). Without it
 * a session there can still read this project, but only by billing its calls to the site's.
 */
resource "google_project_iam_member" "owner_mcp" {
  project = local.project_id
  role    = "roles/mcp.toolUser"
  member  = local.owner
}
