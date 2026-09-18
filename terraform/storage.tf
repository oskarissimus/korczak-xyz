/*
 * Where /apps/sloper/ keeps the things it makes.
 *
 * WHY A BUCKET EXISTS AT ALL NOW. The video wizard used to hold an entire sitting in memory and
 * lose it on reload — twelve generated pictures and twelve narrations, paid for per request, gone
 * to a stray tap. The objection to saving them was never Firestore, it was size: a document is
 * capped at 1 MiB and a processed JPEG is a few hundred kB before base64 adds a third. So the
 * scenes and the wizard's position go in Firestore and the bytes come here, which is the split
 * `korczak-xyz/src/utils/sloper/projects.ts` describes at length.
 *
 * WHY IT IS HERE RATHER THAN IN THE FIREBASE CLI's COLUMN. Read the ownership table in README.md
 * before moving it. The CLI owns `storage.rules`, exactly as it owns `firestore.rules`; this
 * directory owns the bucket the rules apply to, exactly as it owns the export bucket next door.
 * The Firestore *database* is the resource deliberately in neither column, and that is not a
 * precedent for this one: the database predates Terraform and is every other tool's read-write
 * target, whereas this bucket has never existed and has exactly one consumer.
 *
 * THE NAME IS NOT `korczak-xyz-501720.firebasestorage.app`. That is what the Firebase console
 * would have called a default bucket, and it is what `PUBLIC_FIREBASE_STORAGE_BUCKET` used to say
 * — for a bucket that was never created, because nobody ever pressed the button. A `.app` name is
 * a domain-named bucket and creating one outside the console means proving ownership of a domain
 * Google owns, so it cannot be declared here. A plain project-prefixed name can, and the SDK does
 * not care which it is handed.
 *
 * TWO RESOURCES, NOT ONE. `google_storage_bucket` makes it a bucket; `google_firebase_storage_bucket`
 * is what makes the Firebase SDK and `storage.rules` able to see it. Without the second, an upload
 * from the browser gets a 404 from a bucket that plainly exists, which is a confusing afternoon.
 */

/*
 * The beta provider, which exists in this directory only for the one resource below —
 * `google_firebase_storage_bucket` has no GA counterpart. It is pinned to the same exact version
 * as the GA provider, and for the same reason: two runs a month apart must resolve the same
 * thing, and an upgrade is a deliberate two-line commit rather than something that happens while
 * nobody is looking.
 */
provider "google-beta" {
  project = local.project_id
  region  = local.region
}

resource "google_storage_bucket" "sloper" {
  project  = local.project_id
  name     = "${local.project_id}-sloper"
  location = local.region

  uniform_bucket_level_access = true

  /*
   * Nothing in this bucket is fetched by URL from the public internet. The browser reads its own
   * objects through the Firebase Storage API, which resolves the download token and serves the
   * bytes as the service agent — so blocking public access costs the app nothing and takes away
   * the one way somebody's video could become a link anybody can open.
   */
  public_access_prevention = "enforced"

  /*
   * CORS, AND THE ONE REQUEST SHAPE THAT NEEDS IT.
   *
   * `getDownloadURL()` hands back a `firebasestorage.googleapis.com` URL and the app uses it two
   * ways. An `<img src>` or an `<audio src>` needs nothing from this block — pointing a media
   * element at a URL is not a cross-origin *read* — which is why the assets screen has always
   * drawn correctly and why this looked for all the world like a bucket that was working.
   * `fetch()` is the other way, and it is the one that was broken: reopening a project fetches
   * the finished MP4 eagerly, and `blobForAsset` fetches a picture or a narration back out of the
   * bucket when the assembler asks for it. Those are the only two reads there are, and they are
   * the whole reason a sitting paid for on a laptop can be finished on a phone.
   *
   * WHY IT IS SO EASY TO PROVE THE WRONG THING HERE. The Firebase Storage API answers an *error*
   * — a 403 for an object that is not there, an OPTIONS preflight — with
   * `Access-Control-Allow-Origin: *` whatever this block says. Only a successful `?alt=media`
   * response is served with the bucket's own CORS config applied. So curling a bad path comes
   * back permissive and proves nothing at all: the header is on the response that carries no
   * bytes. With no config here, the 200 carrying the bytes came back with no ACAO header at all,
   * the browser refused to let the page read a response it had already downloaded, and Safari
   * reported the whole thing as `TypeError: Load failed`.
   *
   * What that looked like from the app, which is the part worth recognising again: a project
   * assembled in one sitting worked perfectly, because every blob was still in memory and
   * `blobForAsset` never fetched anything. Reopen that same project and the video would not load
   * — it was in the bucket the whole time, saved exactly as intended — and pressing Assemble
   * failed with "The video could not be assembled. Load failed." The one thing this bucket exists
   * for was the only thing that could not work.
   *
   * THE ORIGINS ARE `corsOrigin`'s, in functions/src/sloper/metadata.ts. That is one allowlist
   * written twice in two languages with nothing but a test to keep them honest — both answer
   * "which page may read this account's own bytes", and `metadata.test.ts` reads this file as
   * text and fails if the two lists drift apart.
   *
   * GET AND HEAD ONLY. An upload goes to the API's upload endpoint rather than to the object, and
   * that endpoint sets `ACAO: *` itself — which is exactly why saving a project worked all along
   * while reading one back did not. Adding PUT or POST here would widen the bucket for a request
   * the browser never makes.
   */
  cors {
    origin = [
      "https://korczak.xyz",
      "https://www.korczak.xyz",
      # `astro dev` and `astro preview`.
      "http://localhost:4321",
      "http://localhost:4322",
    ]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag"]
    max_age_seconds = 3600
  }

  /*
   * NO LIFECYCLE RULE, UNLIKE THE EXPORT BUCKET, AND DELIBERATELY SO. A nightly full export is a
   * copy of something that still exists, so deleting old ones loses nothing. These objects are the
   * only copy there is of a picture somebody paid a provider to draw — an `age = 90` here would
   * quietly empty a project somebody came back to after a busy quarter, which is the exact failure
   * the whole feature was built to stop.
   *
   * The bill it is traded against is small enough to say out loud: a twelve-scene project is a few
   * megabytes of JPEG and MP3 plus an MP4 the assembler caps at 32 MiB, so a hundred of them is
   * single-digit gigabytes, which is cents a month at standard-class rates in europe-central2.
   * If that ever stops being true the answer is a Delete button in the Open window — a person
   * throwing away their own project — not a timer doing it for them.
   */

  /*
   * Deleting this bucket deletes every saved project with it. The workflow's "no plan may destroy
   * anything" gate covers it too; this is the second lock, the same pair the export bucket has.
   */
  lifecycle {
    prevent_destroy = true
  }
}

/*
 * What tells Firebase the bucket is one of its own.
 *
 * This is the resource that makes `getStorage()` in the browser able to address it and makes
 * `firebase deploy --only storage` able to put rules on it. It creates nothing — the bucket above
 * already exists by the time this runs — it registers it.
 *
 * ORDERING WITH THE DEPLOY JOB IS ALREADY RIGHT, unlike the `run.invoker` bindings in
 * functions.tf. Those attach to services the Firebase CLI creates, so a new function is a
 * two-pass landing; nothing about this one waits on the deploy, so it lands in a single pass and
 * `firebase deploy --only storage` in the job after it finds a bucket to talk to.
 */
resource "google_firebase_storage_bucket" "sloper" {
  provider  = google-beta
  project   = local.project_id
  bucket_id = google_storage_bucket.sloper.name
}
