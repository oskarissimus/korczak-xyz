# The project layer

What `korczak-xyz-501720` must have switched on and granted, as files CI applies, instead of as
console history and a table in `functions/README.md` that had already drifted from the truth once.

## Why

Two deploys in a row failed for reasons that were not in the code:

- `GEMINI_API_KEY` did not exist in Secret Manager, and a secret named in a function's `secrets`
  array must exist before the CLI will deploy **anything**. Perfectly good code, red build.
- The classifier's identity may or may not hold `roles/aiplatform.user`, and
  `aiplatform.googleapis.com` may or may not be enabled — so "does the classifier work" was a
  question answered by running commands and reading output.

Both are project state. Project state that is not written down is state that gets rediscovered.

## The ownership line

**This is the most important thing in this directory.**

| Terraform owns | The Firebase CLI owns |
|---|---|
| enabled APIs | `collectEvents`, `sendTestPush` |
| IAM role grants | `firestore.rules` |
| secret **containers** | `firestore.indexes.json` |
| `run.invoker` on `sendTestPush` | the code, the schedule |
| the `gcf-artifacts` cleanup policy | |

Nothing may be in both columns. Two owners of one resource is permanent drift: every
`terraform apply` reverts what the last `firebase deploy` did, and back again, with neither tool
wrong. That is why the functions themselves are not here even though Terraform could describe them.

**Secret values are not here.** Terraform state stores them in the clear, and `VAPID_PRIVATE_KEY`
in a state file is a worse problem than the one this solves. Only the containers are declared —
their *absence* is what broke the deploy. Values still go in with
`firebase functions:secrets:set NAME`.

Adding a secret is therefore: a line in `secrets.tf`, push, then set the value once.

## The accepted trade

Applying IAM changes needs `roles/resourcemanager.projectIamAdmin` on the identity that applies
them, and that role is the right to grant itself any other role. Here that identity is the **same
service account the deploy uses**, so a pipeline that fires on every push to `main` holds it.

That was a deliberate choice, made knowing the alternative: a separate `terraform@` account used by
a separate job, so the everyday deploy identity stays narrow. It is written down here so that in six
months it reads as a decision rather than an oversight. The boundary that remains is the WIF
provider's `attribute-condition`, which pins the pool to this repository — so whoever can push to
`main` can change this project's IAM.

If it ever starts to itch, the way out is that second account: a `terraform` job authenticating as
`terraform@`, with the deploy job left exactly as it is.

## Bootstrap — once, ever

Unavoidable, and worth being plain about: **Terraform does not remove this step, it removes every
one after it.** An account cannot grant itself permissions it does not have, and a GCS backend
cannot create the bucket it stores itself in.

Until this is run, the `terraform` job in `firebase-deploy.yml` finds no state bucket, logs a
warning and skips — the app still deploys exactly as it did before. Nothing is blocked by not having
done it yet.

```sh
PROJECT=korczak-xyz-501720
SA=$(gh variable get GCP_SERVICE_ACCOUNT)     # or copy it out of the repo's Variables

# State. Versioned, because losing it means Terraform forgets it owns the imported
# secrets and registry and tries to create them again.
gcloud storage buckets create "gs://$PROJECT-tfstate" \
  --project="$PROJECT" --location=europe-central2 --uniform-bucket-level-access
gcloud storage buckets update "gs://$PROJECT-tfstate" --versioning

# What the deploy account needs to manage the table above. projectIamAdmin is the one
# that carries the trade described in the previous section; the rest are narrow.
for ROLE in roles/serviceusage.serviceUsageAdmin \
            roles/resourcemanager.projectIamAdmin \
            roles/secretmanager.admin \
            roles/artifactregistry.admin \
            roles/run.admin \
            roles/storage.admin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE"
done
```

Then push anything, or re-run the workflow.

## The first apply adopted what existed — done, 30 Aug 2026

`imports.tf` held `import` blocks rather than asking anyone to run `terraform import`; the adoption
happened in CI like everything else, and the file is gone now that it has run. Only resources whose
*creation* would fail if they already exist were imported — the three secret containers and
`gcf-artifacts`. APIs and IAM members are idempotent, so importing them would have added a way to
fail for no benefit.

What that first apply reported:

```
Plan:  4 to import, 15 to add, 1 to change, 0 to destroy
Apply: 4 imported, 15 added, 1 changed, 0 destroyed
```

The one change was attaching the cleanup policy to `gcf-artifacts`. The next run planned **no
changes**, which is the acceptance test: state and the project agree, so nothing here is quietly
about to be altered.

**Keep that test.** A non-empty plan on a run that changed no files means these files describe
something other than what is really in the project, and `apply` would then *change* it — which for
`gcf-artifacts` means the images the live functions are running from.

## No lock file

`terraform init` writes `.terraform.lock.hcl` and asks for it to be committed. It is not here,
because nothing in this repo can run Terraform outside CI and the lock's hashes are
platform-specific — generating one would mean a round trip through a build to fetch a file.

The provider is pinned to an **exact** version in `main.tf` instead. That gets the property that
matters: two runs a month apart resolve the same provider, and upgrading is a deliberate one-line
commit. What it gives up is the lock's checksum pinning, which is a supply-chain guarantee rather
than a determinism one.

## Guards, and what it means when one fires

- **`prevent_destroy`** on the secrets and on `gcf-artifacts`: any plan that would replace or remove
  them fails the apply instead. `VAPID_PUBLIC_KEY` can never be reissued — rotating it silently
  invalidates every push subscription on every device, and 403 is deliberately not a code that
  prunes one, so nothing self-heals and nothing says why.
- **"Refuse a plan that destroys anything"** in the workflow: the same rule over the whole
  directory, including resources somebody adds later and forgets to guard. This repo commits
  straight to `main`, so there is no pull request at which a human reads the plan; this is the gate
  instead.
- **`disable_on_destroy = false`** on every API: without it, deleting a line from the list — or a
  typo that renames a resource — *disables* that API in the project, taking live functions down to
  fix a text file.
- **`google_project_iam_member`, never `_binding` or `_policy`.** Only `_member` is additive.
  `_binding` is authoritative for a whole role and `_policy` for the whole project: applying one
  drops every binding not written here, including the ones that let you and CI back in.

## Rebuilding from nothing

Not the case this exists for, but worth knowing it is a two-pass: `functions.tf` attaches to a Cloud
Run service and an Artifact Registry repository that only exist once the functions have been
deployed. So: apply → `firebase deploy` → apply. On this project both already exist and the ordering
never comes up.
