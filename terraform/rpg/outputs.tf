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
