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

    # The audio guide's two providers. Read by the Go function in audio-guide-function/, which
    # gcloud deploys rather than the Firebase CLI - see the grant at the bottom of this file.
    "OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
  ]

  audio_guide_secrets = ["OPENAI_API_KEY", "ELEVENLABS_API_KEY"]
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

/*
 * The audio guide's runtime may read its two keys.
 *
 * The Firebase CLI grants this itself for every secret a Node function names, which is why the
 * three secrets above need no line here. `gcloud functions deploy --set-secrets` does not: it
 * mounts the secret and leaves the grant to you, and without it the new revision fails to start
 * with a permission error on the secret rather than on anything that says IAM. The runtime is the
 * default compute account, whose `roles/editor` does not include `secretAccessor`.
 *
 * Per secret, not project-wide, so the audio guide's identity grant reads exactly the two keys it
 * uses. `_member`, so it is additive like everything else in this directory.
 */
resource "google_secret_manager_secret_iam_member" "audio_guide_reads_keys" {
  for_each = toset(local.audio_guide_secrets)

  project   = local.project_id
  secret_id = google_secret_manager_secret.app[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.functions_runtime_sa}"
}
