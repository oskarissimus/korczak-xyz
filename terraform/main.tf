/*
 * The project layer of korczak-xyz-501720, as a file rather than as console history.
 *
 * Why this exists: twice in a row a deploy failed for a reason that was not in the code. A secret
 * container that did not exist stopped the CLI deploying *anything*; an API that may or may not be
 * enabled and a role that may or may not be granted turned "does the classifier work" into a
 * question you answer by running commands. None of that was written down anywhere executable — it
 * lived in the console and in a table in functions/README.md, which is a description and had
 * already drifted from the truth once.
 *
 * THE OWNERSHIP LINE, which is the most important thing in this directory:
 *
 *   Terraform owns the PROJECT — APIs, IAM, secret containers, the invoker binding, the registry
 *   cleanup policy.
 *   The Firebase CLI owns the APPLICATION — the functions, firestore.rules, firestore.indexes.json.
 *
 * Nothing may be in both. Two owners of one resource is permanent drift, where every `terraform
 * apply` reverts what the last `firebase deploy` did and back again, and neither tool is wrong.
 *
 * SECRET VALUES ARE NOT HERE. Terraform state stores them in the clear, and VAPID_PRIVATE_KEY
 * sitting in a state file is a worse problem than the one this solves. Only the containers are
 * declared — their absence is what broke the deploy; their contents still go in by hand with
 * `firebase functions:secrets:set`.
 */

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }

  /*
   * State lives in GCS, versioned. It is the one artefact here whose loss costs more than
   * recreating it: without it Terraform no longer knows it owns the imported secrets and registry,
   * and would try to create them again.
   *
   * The bucket is created once by the bootstrap in README.md — a backend cannot create its own
   * store, which is the same chicken-and-egg as the IAM grant.
   */
  backend "gcs" {
    bucket = "korczak-xyz-501720-tfstate"
    prefix = "project"
  }
}

locals {
  project_id = "korczak-xyz-501720"

  /* Where the functions run. Note this is NOT where the model is asked — see LOCATION in
   * functions/src/classify.ts, which is `global` because generative models are served from a
   * smaller set of regions than Cloud Functions are. */
  region = "europe-central2"
}

provider "google" {
  project = local.project_id
  region  = local.region
}

/*
 * Read rather than written: the project number is what the default service account's email is
 * built from, and hardcoding a number nobody can verify by eye is how a config comes to grant a
 * role to an account that does not exist.
 */
data "google_project" "this" {
  project_id = local.project_id
}

locals {
  /*
   * What the gen-2 functions run as.
   *
   * `firebase.json` does not set `serviceAccount`, so they take the default compute account. That
   * is the identity the classifier authenticates to Vertex AI with — see the header of
   * functions/src/classify.ts.
   */
  functions_runtime_sa = "${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}
