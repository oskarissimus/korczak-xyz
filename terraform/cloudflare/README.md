# The Cloudflare layer

What the Cloudflare account and the `korczak.xyz` zone must have, as files CI applies. It is the
Cloudflare counterpart of `../` (the GCP project layer) and copies its conventions: an exact
provider pin and no lock file, state in `gs://korczak-xyz-501720-tfstate` (prefix `cloudflare`), a
CI gate that refuses any plan that deletes, and an ownership line.

| Terraform owns (here) | Wrangler owns |
|---|---|
| the `korczak-xyz-media` R2 bucket | the `korczak-xyz` Worker and its assets (`korczak-xyz/wrangler.jsonc`) |
| `media.korczak.xyz`, the bucket's custom domain, and the DNS record it makes | the apex custom domain and its `100::` record |
| `mail.korczak.xyz`: SPF, Firebase verification TXT and two DKIM CNAMEs for Firebase Auth's mail (`mail.tf`) | the objects in the bucket (`korczak-xyz/scripts/song-videos.mjs`) |
| `contact@korczak.xyz`: Email Routing, its destination address and rule, and the apex SPF (`email.tf`) | |

The three apex MX records (`route1/2/3.mx.cloudflare.net`) belong to neither column: Email Routing
adds and locks them itself, with priorities it picks, so they are Cloudflare's.

Nothing may be in both columns.

It is a separate root from `../`, applied by its own workflow (`.github/workflows/cloudflare.yml`),
so a Cloudflare failure never holds back a Cloud Functions deploy or the site.

## Credentials

- `secrets.CLOUDFLARE_API_TOKEN` — the same token `wrangler deploy` uses in `node.js.yml`. It needs
  **Account → Workers R2 Storage: Edit** and **Zone → Zone: Read** (to look the zone up) on top of
  what the deploy already needs, plus **Zone → DNS: Edit** (`mail.tf`), and for `email.tf`
  **Zone → Email Routing Rules: Edit**, **Account → Email Routing Addresses: Edit** and
  **Zone → Zone Settings: Edit** (enabling routing on the zone). A token without them fails at
  `plan` or `apply` with a 403 naming the call.
- `vars.CLOUDFLARE_ACCOUNT_ID` — as for wrangler.
- GCP Workload Identity — only to reach the state bucket.

## contact@

Mail to `contact@korczak.xyz` is forwarded to the owner's Gmail by Email Routing (`email.tf`). It
delivers nothing until the destination address is verified: Cloudflare mails a link to it on the
first apply, once. A new link is *Email → Email Routing → Destination addresses → Resend* in the
dashboard. Anything else `@korczak.xyz` is dropped (the catch-all is left at its default).

**The domain still sends nothing of its own.** Replying *as* contact@ from Gmail's *Send mail as*
through `smtp.gmail.com` does not pass the zone's DMARC (`p=reject; adkim=s; aspf=s` on
`_dmarc.korczak.xyz`): Gmail signs with gmail.com and the envelope is the gmail.com address, so
neither SPF nor DKIM aligns with korczak.xyz and receivers that honour DMARC reject the reply.
Sending as contact@ needs either an SMTP relay that signs DKIM for korczak.xyz (its records then
go here), or a weaker DMARC. Neither is done yet.

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
