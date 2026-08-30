/*
 * The APIs this project needs switched on.
 *
 * Deliberately NOT imported. Enabling an already-enabled service is a successful no-op, so
 * Terraform can simply "create" every one of these on the first apply and record it — whereas an
 * `import` block for a service that turns out not to be enabled fails, and one failed import fails
 * the whole apply. The list is therefore safe to be wrong in the direction of "too many".
 *
 * `aiplatform` is the one that prompted all of this: the classifier calls Vertex AI as the
 * function's own identity, and whether the API is on for the project is a fact nothing in the
 * deploy path was checking.
 */

locals {
  services = [
    # The function runtime and its build pipeline.
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "pubsub.googleapis.com",

    # The schedule that drives the collector.
    "cloudscheduler.googleapis.com",

    # Secrets, and the data the app stores.
    "secretmanager.googleapis.com",
    "firestore.googleapis.com",

    # Workload Identity Federation, which is how CI authenticates without a key.
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "iam.googleapis.com",

    # The classifier.
    "aiplatform.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  project = local.project_id
  service = each.value

  /*
   * Both defaults here are dangerous and both are turned off.
   *
   * `disable_on_destroy` defaults to TRUE, which means deleting a line from the list above — or a
   * typo that renames a resource — DISABLES the API in the project. That takes down live functions
   * to fix a text file. Removing a service from Terraform's management should mean exactly that,
   * and nothing more.
   *
   * `disable_dependent_services` would cascade the same thing outward, which is worse.
   */
  disable_on_destroy         = false
  disable_dependent_services = false
}
