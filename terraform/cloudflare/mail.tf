/*
 * mail.korczak.xyz: the sender domain for Firebase Auth's mail on korczak.xyz (project
 * korczak-xyz-501720) — the verification mail, from noreply@mail.korczak.xyz instead of
 * noreply@korczak-xyz-501720.firebaseapp.com, which Gmail filed as spam (9 Nov 2026).
 *
 * The four records are the ones the Firebase console printed under Authentication → Templates →
 * Customize domain; that step has no public API (`dnsInfo.pendingCustomDomain` is output-only), so
 * it was done by hand and these values are copied from it. If the domain is ever re-entered there,
 * the console prints them again — compare before changing anything here.
 *
 * A subdomain, so the apex keeps `v=spf1 -all` (it sends no mail). The zone's DMARC (`p=reject`,
 * inherited by subdomains) passes on DKIM: Firebase signs as mail.korczak.xyz through the two
 * CNAMEs, which is aligned with the From address.
 *
 * DNS only, never proxied: a proxied CNAME is flattened to Cloudflare's addresses and the DKIM
 * lookup would find no key.
 */

locals {
  firebase_mail_domain = "mail.korczak.xyz"
}

resource "cloudflare_dns_record" "mail_spf" {
  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  name    = local.firebase_mail_domain
  type    = "TXT"
  content = "\"v=spf1 include:_spf.firebasemail.com ~all\""
  ttl     = 1
  comment = "Firebase Auth sender (terraform/cloudflare/mail.tf)"
}

resource "cloudflare_dns_record" "mail_firebase_verification" {
  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  name    = local.firebase_mail_domain
  type    = "TXT"
  content = "\"firebase=korczak-xyz-501720\""
  ttl     = 1
  comment = "Firebase Auth sender (terraform/cloudflare/mail.tf)"
}

resource "cloudflare_dns_record" "mail_dkim" {
  for_each = toset(["1", "2"])

  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  name    = "firebase${each.value}._domainkey.${local.firebase_mail_domain}"
  type    = "CNAME"
  content = "mail-mail-korczak-xyz.dkim${each.value}._domainkey.firebasemail.com"
  proxied = false
  ttl     = 1
  comment = "Firebase Auth sender (terraform/cloudflare/mail.tf)"
}
