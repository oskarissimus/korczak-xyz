/*
 * Two facts about the deployed functions that live nowhere else.
 *
 * Both were a sentence in functions/README.md and nothing more, which means both would quietly not
 * exist if this project were ever rebuilt — and one of them is the difference between the Alerts
 * tab's test button working and returning a 403 nobody can explain.
 *
 * ORDERING. This job runs before `firebase deploy`, so on a project where the functions do not
 * exist yet these two resources have nothing to attach to and the apply fails. That is a
 * first-ever-bootstrap concern only, and the answer is the two-pass in README.md: apply, deploy,
 * apply. On this project both targets already exist.
 */

/*
 * `sendTestPush` is called from the browser and must be reachable without a Google identity.
 *
 * It has to be `google_cloud_run_service_iam_member`: a gen-2 function IS a Cloud Run service
 * underneath, and `google_cloudfunctions2_function_iam_member` rejects `roles/run.invoker`
 * outright. The function does its own auth check — it throws `unauthenticated` without a Firebase
 * user — so "public" here means reachable, not unguarded.
 *
 * Additive (`_member`), so it cannot disturb whatever else may invoke the service.
 */
resource "google_cloud_run_service_iam_member" "send_test_push_public" {
  project  = local.project_id
  location = local.region
  service  = "sendtestpush"
  role     = "roles/run.invoker"
  member   = "allUsers"
}

/*
 * Stop the build images accumulating a bill.
 *
 * Every functions deploy pushes a container into `gcf-artifacts`, and nothing removes them. Three
 * days is enough to roll back to the previous build and short enough that the repository does not
 * grow forever.
 *
 * TWO THINGS ABOUT THIS RESOURCE, and they are why it is the riskiest thing in this directory:
 *
 *   1. **`gcf-artifacts` is created and used by Cloud Functions, not by us.** Terraform adopts it
 *      here purely to attach the policy below — there is no separate cleanup-policy resource. So it
 *      carries `prevent_destroy`: any plan that wants to replace this repository would delete the
 *      images the live functions are running from, and it must fail the apply instead.
 *   2. **`older_than` is in SECONDS.** The provider maps it onto a protobuf Duration and units
 *      other than seconds do not work on every version, silently or otherwise. 259200s is three
 *      days; writing "3d" is the bug.
 */
resource "google_artifact_registry_repository" "gcf_artifacts" {
  project       = local.project_id
  location      = local.region
  repository_id = "gcf-artifacts"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-old-builds"
    action = "DELETE"
    condition {
      older_than = "259200s" # 3 days
    }
  }

  lifecycle {
    prevent_destroy = true

    /*
     * Everything else about this repository belongs to Cloud Functions. Describing it here would
     * mean Terraform and the CLI arguing about fields neither of them needs us to own.
     */
    ignore_changes = [labels, description]
  }
}
