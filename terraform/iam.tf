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
