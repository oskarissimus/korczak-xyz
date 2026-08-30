/*
 * Adopting what already exists, without anybody running a command.
 *
 * `terraform import` from a terminal would work and is the usual way; `import` blocks (Terraform
 * 1.5+) do it from CI instead, which is the whole point of this directory existing. The plan shows
 * what it will adopt, the apply adopts it, and this file is then deleted in a follow-up commit —
 * an import block for an already-imported resource is a no-op, but leaving them is leaving
 * scaffolding up.
 *
 * ONLY the resources whose creation would FAIL if they already exist are here. APIs and IAM
 * members are idempotent — enabling an enabled service and granting a held role both succeed — so
 * importing them would add risk (a failed import fails the whole apply) for no benefit.
 *
 * THE ACCEPTANCE TEST IS AN EMPTY PLAN. After this has applied once, the next run must plan zero
 * changes. A non-empty plan means the configuration describes something different from what is
 * really in the project, and `apply` would then CHANGE it — which for the artifact registry means
 * the images the live functions run from.
 */

import {
  to = google_secret_manager_secret.app["VAPID_PUBLIC_KEY"]
  id = "projects/korczak-xyz-501720/secrets/VAPID_PUBLIC_KEY"
}

import {
  to = google_secret_manager_secret.app["VAPID_PRIVATE_KEY"]
  id = "projects/korczak-xyz-501720/secrets/VAPID_PRIVATE_KEY"
}

import {
  to = google_secret_manager_secret.app["TICKETMASTER_API_KEY"]
  id = "projects/korczak-xyz-501720/secrets/TICKETMASTER_API_KEY"
}

import {
  to = google_artifact_registry_repository.gcf_artifacts
  id = "projects/korczak-xyz-501720/locations/europe-central2/repositories/gcf-artifacts"
}
