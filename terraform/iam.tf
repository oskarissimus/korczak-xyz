/*
 * Who may do what.
 *
 * **`google_project_iam_member`, never `_binding` and never `_policy`.** This is the classic
 * Terraform-on-GCP footgun and it is worth being explicit about, because the three resources look
 * interchangeable and are not:
 *
 *   - `_member`  manages ONE (role, member) pair and leaves every other member of that role alone.
 *   - `_binding` is authoritative for the whole ROLE: it removes every member not listed here.
 *   - `_policy`  is authoritative for the whole PROJECT: applying it drops every binding not in
 *                this file, including the ones that let you and CI back in.
 *
 * Only `_member` is additive, and only additive is safe in a project whose IAM was set up by hand
 * and is not fully described here.
 *
 * These are also not imported: granting a role a member already has is idempotent, so the first
 * apply simply records what is already true.
 */

/*
 * The classifier's permission to call Vertex AI.
 *
 * The second half of "no API key". The function has an identity; this is what makes that identity
 * allowed to ask the model anything. Without it the calls 403, every event stays unlabelled, and
 * `eventSources/classifier` goes red on the Alerts tab — visible, and not destructive, because an
 * unlabelled event passes the places rule.
 */
resource "google_project_iam_member" "functions_vertex_ai" {
  project = local.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${local.functions_runtime_sa}"
}

/*
 * What lets `storage.rules` read `accounts/{uid}` out of Firestore.
 *
 * The bucket's rules gate every upload on the same approval document the site's Firestore rules
 * do, which is a cross-service rule: the lookup is made by the Cloud Storage for Firebase service
 * agent, not by the caller, and that agent can only make it while it holds this role. Without the
 * grant every write to the sloper bucket is denied — the safe direction, and an entirely silent
 * one from the browser, which sees a plain 403 on a picture it just made.
 *
 * The service agent is addressed by project NUMBER, read from `data.google_project.this` for the
 * reason given where that data source is declared: an email built from a number nobody can check
 * by eye is how a grant comes to name an account that does not exist.
 *
 * This is also the ordering the deploy workflow's `terraform` → `deploy` dependency exists for.
 * The apply lands the role, and only then does the CLI push rules that need it.
 */
resource "google_project_iam_member" "firebasestorage_reads_firestore" {
  project = local.project_id
  role    = "roles/firebaserules.firestoreServiceAgent"
  member  = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
}
