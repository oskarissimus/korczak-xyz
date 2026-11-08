/*
 * Placeholders for the site's three secrets, which the game never reads.
 *
 * The Firebase CLI resolves every `defineSecret` in the codebase before it deploys anything, even
 * with `--only functions:rpgDemo,...`, and stops on one with no value ("In non-interactive mode but
 * have no value for the secret VAPID_PUBLIC_KEY") — that is how the first release failed. The game's
 * functions name none of them, so each gets a container and one version saying so, and nothing
 * here is a real value: state holding these costs nothing.
 *
 * The other way out is a second functions codebase for the game, which is a refactor of
 * functions/; this is three resources.
 */
locals {
  unused_site_secrets = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "TICKETMASTER_API_KEY"]
}

resource "google_secret_manager_secret" "unused" {
  for_each  = toset(local.unused_site_secrets)
  project   = local.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "unused" {
  for_each    = google_secret_manager_secret.unused
  secret      = each.value.id
  secret_data = "unused: korczak-rpg runs only the game's functions, which never read this"
}
