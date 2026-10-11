/*
 * The songbook's videos: an R2 bucket served at https://media.korczak.xyz.
 *
 * Why R2, why plain MP4 and why the files are named by content hash is in
 * .claude/rules/songbook.md, *Videos*. Only the bucket and its domain are here; the objects are
 * uploaded by korczak-xyz/scripts/song-videos.mjs, which owns them.
 */

resource "cloudflare_r2_bucket" "media" {
  account_id = var.cloudflare_account_id
  name       = "korczak-xyz-media"
  // eeur: the listeners are in Poland. A placement hint, not a jurisdiction; the domain below is
  // cached at every edge regardless.
  location = "eeur"

  lifecycle {
    // Holds every uploaded video. Recreating it is an empty bucket under a live site.
    prevent_destroy = true
  }
}

/*
 * The custom domain creates and owns its own DNS record (`media`, proxied), which is why there is
 * no cloudflare_dns_record for it — declaring one would be two owners of one record.
 */
resource "cloudflare_r2_custom_domain" "media" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name
  domain      = "media.korczak.xyz"
  zone_id     = data.cloudflare_zone.korczak_xyz.zone_id
  enabled     = true
  min_tls     = "1.2"
}
