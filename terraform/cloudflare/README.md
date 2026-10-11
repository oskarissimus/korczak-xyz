# The Cloudflare layer

What the Cloudflare account and the `korczak.xyz` zone must have, as files CI applies. It is the
Cloudflare counterpart of `../` (the GCP project layer) and copies its conventions: an exact
provider pin and no lock file, state in `gs://korczak-xyz-501720-tfstate` (prefix `cloudflare`), a
CI gate that refuses any plan that deletes, and an ownership line.

| Terraform owns (here) | Wrangler owns |
|---|---|
| the `korczak-xyz-media` R2 bucket | the `korczak-xyz` Worker and its assets (`korczak-xyz/wrangler.jsonc`) |
| `media.korczak.xyz`, the bucket's custom domain, and the DNS record it makes | the apex custom domain and its `100::` record |
| | the objects in the bucket (`korczak-xyz/scripts/song-videos.mjs`) |

Nothing may be in both columns.

It is a separate root from `../`, applied by its own workflow (`.github/workflows/cloudflare.yml`),
so a Cloudflare failure never holds back a Cloud Functions deploy or the site.

## Credentials

- `secrets.CLOUDFLARE_API_TOKEN` — the same token `wrangler deploy` uses in `node.js.yml`. It needs
  **Account → Workers R2 Storage: Edit** and **Zone → Zone: Read** (to look the zone up) on top of
  what the deploy already needs. A token without them fails at `plan` with a 403 naming the call.
- `vars.CLOUDFLARE_ACCOUNT_ID` — as for wrangler.
- GCP Workload Identity — only to reach the state bucket.

## Planned: one token, then nothing by hand

The goal is the same shape as the GCP side, where one bootstrap grants the deploy identity
`projectIamAdmin` and everything after that is a commit. On Cloudflare that is:

1. **Once, by hand:** an account-owned API token, *Terraform*, with **Account API Tokens: Edit**,
   **Workers R2 Storage: Edit**, **Workers Scripts: Edit**, **Account Settings: Read**, and on the
   `korczak.xyz` zone **Zone: Read**, **DNS: Edit**, **Zone Settings: Edit**, **Single Redirect: Edit**.
   Stored as the repository secret `CLOUDFLARE_API_TOKEN`, replacing the deploy-only one.
2. **From then on, in code:** the zone's DNS records and the *www → apex* Single Redirect are
   imported here (`import` blocks, applied by CI), which takes the one piece of the serving path
   that CLAUDE.md says is not in git and puts it in git.
3. **Optional, later:** Terraform mints the narrow token wrangler deploys with
   (`cloudflare_account_token`) and writes it to GitHub through the `github` provider, so the
   super token is only ever used by this workflow. That needs a GitHub token able to write repo
   secrets — a second bootstrap secret — which is why it is a separate step.

**The accepted trade**, the same one `../README.md` writes down: *Account API Tokens: Edit* is the
right to mint a token with any permission, so whoever can push to `main` controls the account.
The boundary is who can push to `main`.
