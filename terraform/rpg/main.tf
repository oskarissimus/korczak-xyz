/*
 * The RPG's production project, korczak-rpg — the GCP half of rpg.korczak.xyz.
 *
 * A project of its own so that the game's production cannot be touched by anything that ships from
 * main, and so its bill, quotas and data are its own. The site's project layer is `terraform/` one
 * level up; this directory is the same idea for the other project, applied by
 * .github/workflows/rpg-terraform.yml.
 *
 * WHAT IS NOT HERE, AND WHY:
 *
 *   - The project itself. It was created by hand (8 Nov 2026), and Terraform could not have done
 *     it: making a project is a right of the person, not of any identity in this repo.
 *   - The billing link. Linking needs `billing.user` on the billing account, which no CI identity
 *     holds or should hold. Done once in the console.
 *   - The very first grant. Somebody has to let a CI identity into a new project before CI can do
 *     anything there, so the site's deployer (github-deployer@korczak-xyz-501720) was granted
 *     Owner on korczak-rpg by hand. Everything else is in these files. Once the release workflow
 *     runs as the project's own deployer (iam.tf), that bootstrap grant can be revoked.
 *
 * State shares the site's bucket under its own prefix. A second bucket in this project would be a
 * second bootstrap step for no gain: the state is the record of this directory, not production
 * data.
 */

terraform {
  required_version = ">= 1.5"

  required_providers {
    # Pinned exactly, as in terraform/main.tf and for the same reason.
    google = {
      source  = "hashicorp/google"
      version = "8.0.0"
    }
    # For `google_firebase_project` only, which has no GA counterpart.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "8.0.0"
    }
  }

  backend "gcs" {
    bucket = "korczak-xyz-501720-tfstate"
    prefix = "rpg"
  }
}

locals {
  project_id = "korczak-rpg"
  region     = "europe-central2"

  repository = "oskarissimus/korczak-xyz"
  # The GitHub environment the release job runs in (.github/workflows/rpg-release.yml). The pool
  # trusts tokens from that environment and nothing else, so a push to main, a pull request or any
  # other workflow in this repo cannot act on production.
  environment = "rpg-production"

  owner = "user:oskar.jan.korczak@gmail.com"
}

provider "google" {
  project = local.project_id
  region  = local.region
}

provider "google-beta" {
  project = local.project_id
  region  = local.region
}

data "google_project" "this" {
  project_id = local.project_id
}
