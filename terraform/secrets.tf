/*
 * The secret CONTAINERS. Not their values — see the header of main.tf.
 *
 * These exist in Terraform for one reason: a secret named in a Cloud Function's `secrets` array
 * must exist before the firebase CLI will deploy *anything at all*. It stops with
 *
 *     In non-interactive mode but have no value for the secret …
 *
 * which is how adding one line to functions/src/index.ts took down a deploy whose code was
 * perfectly good. Declared here, a new secret is created by the terraform job that runs before the
 * deploy job in the same workflow, and that failure mode is gone.
 *
 * Adding a secret is therefore: a resource here, then `firebase functions:secrets:set NAME` once to
 * put a real value in.
 */

locals {
  secrets = [
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "TICKETMASTER_API_KEY",
  ]
}

resource "google_secret_manager_secret" "app" {
  for_each = toset(local.secrets)

  project   = local.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  /*
   * Deleting a secret container deletes every version in it, and one of these can never be
   * replaced: rotating VAPID_PUBLIC_KEY silently invalidates every push subscription on every
   * device, each one keeps its endpoint, the sender keeps getting 403, and 403 is deliberately not
   * a code that prunes a subscription — so nothing self-heals and nothing says why.
   *
   * `prevent_destroy` turns any plan that would replace or remove one of these into a loud apply
   * failure instead of a quiet catastrophe. If CI ever fails here, that is this rule working.
   */
  lifecycle {
    prevent_destroy = true
  }
}
