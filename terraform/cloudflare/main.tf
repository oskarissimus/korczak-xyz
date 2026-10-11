/*
 * The Cloudflare layer: what the zone and the account must have, as files CI applies.
 *
 * A separate root from ../ (the GCP project layer) on purpose. The two share nothing — no
 * resource in one refers to the other — and they fail for unrelated reasons: a Cloudflare token
 * missing a permission must not block a Cloud Functions deploy, which is what sharing a root
 * with ../ and its `needs: terraform` in firebase-deploy.yml would do. Its state sits in the
 * same GCS bucket under its own prefix, because that bucket is already versioned and already
 * reachable from CI; where the state lives says nothing about which vendor the resources are in.
 *
 * THE OWNERSHIP LINE, as in ../main.tf:
 *
 *   Terraform owns the PLATFORM — buckets, their custom domains, (later) DNS and zone rules.
 *   Wrangler owns the APPLICATION — the korczak-xyz Worker and its static assets, its custom
 *   domain on the apex (korczak-xyz/wrangler.jsonc), and the objects inside the buckets.
 *
 * Nothing may be in both. In particular the apex AAAA record is the Worker's and stays out of here.
 *
 * Applied by .github/workflows/cloudflare.yml. See README.md beside this file.
 */

terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      // Exact, for the same reason as the google provider in ../main.tf: no lock file is possible
      // here, so the pin is what keeps two runs a month apart on the same provider.
      version = "5.26.0"
    }
  }

  backend "gcs" {
    bucket = "korczak-xyz-501720-tfstate"
    prefix = "cloudflare"
  }
}

// The token comes from CLOUDFLARE_API_TOKEN in the environment; nothing here names it.
provider "cloudflare" {}

// From the repo variable CI already hands wrangler (TF_VAR_cloudflare_account_id in the workflow).
variable "cloudflare_account_id" {
  type = string
}

/*
 * Looked up rather than hardcoded, like the project number in ../main.tf: an id nobody can verify
 * by eye is how a config comes to point at the wrong thing.
 */
data "cloudflare_zone" "korczak_xyz" {
  filter = {
    name = "korczak.xyz"
  }
}
