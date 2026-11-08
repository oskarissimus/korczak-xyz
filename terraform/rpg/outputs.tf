# The three repository variables the release workflow reads (Settings → Secrets and variables →
# Actions → Variables). None of them is a secret: Workload Identity needs no key.
output "RPG_GCP_PROJECT_ID" {
  value = local.project_id
}

output "RPG_GCP_WORKLOAD_IDENTITY_PROVIDER" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "RPG_GCP_SERVICE_ACCOUNT" {
  value = google_service_account.deployer.email
}

# The Firebase block of korczak-xyz/.env.rpg. Public by construction (see .env.production).
output "firebase_web_config" {
  value = {
    PUBLIC_FIREBASE_API_KEY             = data.google_firebase_web_app_config.rpg.api_key
    PUBLIC_FIREBASE_AUTH_DOMAIN         = data.google_firebase_web_app_config.rpg.auth_domain
    PUBLIC_FIREBASE_PROJECT_ID          = local.project_id
    PUBLIC_FIREBASE_STORAGE_BUCKET      = google_storage_bucket.assets.name
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID = data.google_firebase_web_app_config.rpg.messaging_sender_id
    PUBLIC_FIREBASE_APP_ID              = google_firebase_web_app.rpg.app_id
  }
}
