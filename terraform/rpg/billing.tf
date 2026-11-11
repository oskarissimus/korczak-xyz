/*
 * The billing account's export to BigQuery, read by the admin panel's wallets
 * (`functions/src/rpg/wallets.ts`, `readGoogle`): the Gemini API's billing is Cloud Billing, which no
 * API key can read, so this is the only way to the real figure behind the request log's estimate.
 *
 * Terraform makes the dataset and lets the functions read it. Pointing the export at it is a
 * console switch with no API (Billing → Billing export → BigQuery export → Standard usage cost →
 * project korczak-rpg, dataset billing_export), made once by a billing account administrator; until
 * then the panel says the export is missing and Google is typed in by hand.
 *
 * The functions of both projects read it — the game's and korczak.xyz's own admin panel — and run
 * their queries here, so both need the job right in this project as well as read on the dataset.
 */

data "google_project" "site" {
  project_id = "korczak-xyz-501720"
}

locals {
  billing_readers = [
    "serviceAccount:${data.google_project.this.number}-compute@developer.gserviceaccount.com",
    "serviceAccount:${data.google_project.site.number}-compute@developer.gserviceaccount.com",
  ]
}

resource "google_project_service" "bigquery" {
  project            = local.project_id
  service            = "bigquery.googleapis.com"
  disable_on_destroy = false
}

resource "google_bigquery_dataset" "billing_export" {
  project       = local.project_id
  dataset_id    = "billing_export"
  location      = "EU"
  friendly_name = "Cloud Billing export"
  description   = "Standard usage cost export of the billing account; read by the RPG admin panel's wallets."

  depends_on = [google_project_service.bigquery]

  lifecycle {
    # The export writes its table here; deleting the dataset deletes the billing history in it.
    prevent_destroy = true
  }
}

resource "google_bigquery_dataset_iam_member" "billing_readers" {
  for_each   = toset(local.billing_readers)
  project    = local.project_id
  dataset_id = google_bigquery_dataset.billing_export.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = each.value
}

resource "google_project_iam_member" "billing_query" {
  for_each = toset(local.billing_readers)
  project  = local.project_id
  role     = "roles/bigquery.jobUser"
  member   = each.value
}
