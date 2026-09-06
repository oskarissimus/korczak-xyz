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
| the Firestore backup **schedules** | the Firestore **database** itself |
| the export bucket, its schedule and its two accounts | the **key** for the NAS account |

Nothing may be in both columns. Two owners of one resource is permanent drift: every
`terraform apply` reverts what the last `firebase deploy` did, and back again, with neither tool
wrong. That is why the functions themselves are not here even though Terraform could describe them.

**Secret values are not here.** Terraform state stores them in the clear, and `VAPID_PRIVATE_KEY`
in a state file is a worse problem than the one this solves. Only the containers are declared —
their *absence* is what broke the deploy. Values still go in with
`firebase functions:secrets:set NAME`.

Adding a secret is therefore: a line in `secrets.tf`, push, then set the value once.

**The database is not in the right-hand column by accident** — nothing owns it, and that is
deliberate. `firestore.tf` declares the two backup *schedules*, which are standalone resources that
touch nothing else. Declaring `google_firestore_database` to reach the one field next door
(point-in-time recovery) would put every other tool's read-write target under Terraform's
management for a feature with a seven-day window and a continuous bill. See the header of
`firestore.tf`.

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
            roles/storage.admin \
            roles/iam.serviceAccountAdmin; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE"
done
```

`iam.serviceAccountAdmin` was added later than the rest, when `firestore-export.tf` introduced the
first service accounts this directory creates. The account already held `serviceAccountUser` — the
right to *act as* an account — which is a different thing from the right to make one, and a plan
that creates a service account fails without it.

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

## Backups, and how a restore actually goes

`firestore.tf` declares two schedules on `(default)`: **daily, kept 7 days** and **weekly on Sunday,
kept 14 weeks**. Those are the API's maximums for each kind, and one schedule of each kind per
database is also the maximum, so this is as much as scheduled backups can give.

Nothing new had to be granted for it. The deploy account already holds `roles/firebase.admin`,
which carries every `datastore.backupSchedules.*` permission — so unlike the roles in the bootstrap
block, this needed no round trip through a console.

**A restore is not an undo.** Two things about it are worth knowing before the day you need it,
because neither is what the word suggests:

- It creates a **new database**. `(default)` is never overwritten, so recovering means restoring
  beside it and then pointing something at the copy, or copying documents back by hand. There is no
  in-place rollback.
- Granularity is a day. Everything written since the last backup ran is gone. That is the trade
  against point-in-time recovery, which is a database-level flag this directory deliberately does
  not own — see the header of `firestore.tf`.

```sh
gcloud firestore backups list --location=europe-central2 --project=korczak-xyz-501720
gcloud firestore databases restore \
  --source-backup=projects/korczak-xyz-501720/locations/europe-central2/backups/BACKUP_ID \
  --destination-database=restored-YYYYMMDD
```

Backup storage is billed per GiB-month with no free tier. This database holds a sleep log, a few
thousand scraped events and some feed-health rows, so the bill is cents — but it is a new non-zero
line where there was none, and that is the thing being bought: `users/{uid}/babySleep` is typed in
by hand and exists nowhere else.

## The copy that leaves Google

Backups protect against us. They do not protect against losing the account — a suspended project
takes the database and every backup of it at once, because they are the same vendor. So
`firestore-export.tf` builds the other half:

```
Cloud Scheduler ──OAuth as firestore-export@──▶ firestore:exportDocuments
   03:30 Europe/Warsaw                                   │
                                                         ▼
                              gs://korczak-xyz-501720-firestore-export
                                     30-day lifecycle, one folder per run
                                                         │
                                  nas-backup-reader@ ◀───┘  objectViewer only
                                          │
                                          ▼  rclone on cron, on the QNAP
```

**The NAS end is rclone on a cron entry, not HBS** — and that is not a preference,
it is the only thing that works. HBS 3 refuses to create a Google Cloud Storage
storage space at all: it answers "Authentication error. Cannot connect to cloud
service.", and the underlying error is a 401 from the NAS's own cloud layer —
`POST /cc3/v1/users/system/accounts` returning `{"error_code":"cloud_unauthorized"}`.
Ruled out individually: the key itself (it lists and reads the bucket fine from a
laptop, and from the NAS via rclone), the clock, the QTS session, an outdated
myQNAPcloud, the proxy setting, and a full reboot.

**Two separate things were wrong, and the second one is fatal to the idea.**

*Scope.* `nas-backup-reader@` holds `roles/storage.objectViewer` bound at **bucket** scope. That
role contains `resourcemanager.projects.get`, so it reads as sufficient — but a project-scoped
permission granted on a bucket is inert, so HBS's project check failed and returned
"Authentication error. Cannot connect to cloud service." over a cc3 `cloud_unauthorized`. Nothing in
that wording points at scope.

*Capability.* Fixing the scope is not enough. A throwaway account was walked up the ladder:

```
projects.get (project) + objectViewer (bucket)   -> connection created OK
  + storage.buckets.list                          -> job wizard can list buckets and objects
  + objectCreator (bucket)                        -> still "Cannot upload... Permission denied"
  + objectAdmin (bucket)                          -> still "Cannot upload... Permission denied"
  + storage.admin (project)                       -> upload error clears
```

So **HBS does need write access**, even to build a *Restore* (download-only) job, and
bucket-scoped write is not enough — it wanted project-wide storage admin. The widely repeated
claim that read-only suffices is wrong; so was an earlier version of this file, which had only
tested that a *connection* could be created.

**And then it still does not work.** With full `storage.admin` the wizard fails at the last step
with *"No backup data detected. Check the destination path."* while showing `Selected: 1 folders`.
HBS Restore only understands data written by an HBS **backup job**; a bucket of Firestore export
files it did not create is not restorable. HBS Sync is no help either — one-way sync goes NAS to
cloud, and there is no scheduled cloud-to-NAS pull of foreign data anywhere in the product.

**Conclusion: HBS cannot do this job at any permission level.** It is a push-to-cloud tool that can
restore its own backups. Pulling somebody else's bucket down on a schedule is outside what it does.
That, and not the permissions, is why the NAS end is rclone.

So the puller is `rclone v1.75.1` (linux-arm-v7) at
`/share/CE_CACHEDEV1_DATA/firestore-backup/`, run by `0 5 * * *` in
`/etc/config/crontab`, with its own README next to it. It uses **`rclone copy`,
never `sync`** — the bucket's 30-day lifecycle deletes old exports, and `sync`
would mirror those deletions and give the NAS the same 30-day horizon it exists to
outlive.

There is **no Cloud Function** in that path. Scheduler calls the Admin API directly; the export is
one POST with no logic in it, and a function would have added a deploy, a runtime and a language.

Two details in `firestore-export.tf` are the kind that look like style and are not:

- **`outputUriPrefix` is the bare bucket, with no path.** Given a bucket alone the API names each
  run's folder after its start time. Add a path and every night overwrites one prefix, which turns
  thirty days of history into a single folder and makes the lifecycle rule a countdown on the only
  copy.
- **The writer is not the caller.** `firestore-export@` asks for the export; Firestore's own service
  agent writes the files, so that agent is granted `storage.admin` on the bucket explicitly. Being
  in the same project often makes this work unstated — which is the reason to state it, because an
  implicit permission changes without a commit.

**The NAS key is not in Terraform and must not be.** `google_service_account_key` writes the private
key into state in the clear, the same rule that keeps `VAPID_PRIVATE_KEY` out. Mint it once by hand:

```sh
gcloud iam service-accounts keys create hbs.json \
  --iam-account=nas-backup-reader@korczak-xyz-501720.iam.gserviceaccount.com
```

That key now lives at `/share/CE_CACHEDEV1_DATA/firestore-backup/gcs-key.json` on
the NAS, mode 600. `nas-backup-reader@` can read the objects in
one bucket and do nothing else anywhere — which matters because its key is a file on a device on the
LAN. The deploy account's key in the same place would be a `projectIamAdmin` credential sitting in a
QNAP settings pane.

To rotate: `gcloud iam service-accounts keys list --iam-account=…`, create a new one, replace
`gcs-key.json` on the NAS, then delete the old key id. Nothing in Terraform changes.

## Guards, and what it means when one fires

- **`prevent_destroy`** on the secrets, on `gcf-artifacts` and on both backup schedules: any plan that would replace or remove
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
