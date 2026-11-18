/*
 * contact@korczak.xyz: Cloudflare Email Routing, forwarding to the owner's Gmail (18 Nov 2026).
 * Receive-only. Nothing here lets the domain send: replies go out from Gmail, and how that meets
 * the zone's DMARC (`p=reject`, strict alignment) is in README.md, *contact@*.
 *
 * Three pieces, in this order:
 *
 *  1. The apex SPF. It was `v=spf1 -all` — "this domain sends no mail" — created by hand in the
 *     dashboard, so it is imported here rather than declared fresh: two SPF records on one name is
 *     a permerror for every receiver, which is worse than either. Email Routing requires Cloudflare's
 *     include on the apex; `~all` is what its wizard writes.
 *  2. Email Routing on the zone (`cloudflare_email_routing_dns`). This is the call that adds and
 *     locks the three `route*.mx.cloudflare.net` MX records, whose priorities Cloudflare picks per
 *     zone, so they are Cloudflare's records and not declared here. It runs after the SPF change so
 *     it finds its SPF already in place instead of adding a second one.
 *  3. The destination address and the rule. Cloudflare mails the destination a verification link;
 *     until it is clicked the rule exists but delivers nothing.
 */

locals {
  contact_address = "contact@korczak.xyz"
  // The owner's own inbox; the same address terraform/rpg/main.tf and seller.ts already name.
  contact_forward_to = "oskar.jan.korczak@gmail.com"
}

data "cloudflare_dns_records" "apex_spf" {
  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  type    = "TXT"
  name = {
    exact = "korczak.xyz"
  }
  content = {
    contains = "v=spf1"
  }
}

// A no-op once the record is in state; kept so a fresh state finds the record instead of duplicating it.
import {
  to = cloudflare_dns_record.apex_spf
  id = "${data.cloudflare_zone.korczak_xyz.zone_id}/${one(data.cloudflare_dns_records.apex_spf.result).id}"
}

resource "cloudflare_dns_record" "apex_spf" {
  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  name    = "korczak.xyz"
  type    = "TXT"
  content = "\"v=spf1 include:_spf.mx.cloudflare.net ~all\""
  ttl     = 1
  comment = "Email Routing for contact@ (terraform/cloudflare/email.tf)"
}

resource "cloudflare_email_routing_dns" "korczak_xyz" {
  zone_id = data.cloudflare_zone.korczak_xyz.zone_id
  // No `name`: it is for routing a subdomain, and the API refuses the apex there (2007, "must be a
  // subdomains of korczak.xyz"). Left out, it enables the zone itself.

  depends_on = [cloudflare_dns_record.apex_spf]
}

resource "cloudflare_email_routing_address" "owner" {
  account_id = var.cloudflare_account_id
  email      = local.contact_forward_to
}

resource "cloudflare_email_routing_rule" "contact" {
  zone_id  = data.cloudflare_zone.korczak_xyz.zone_id
  name     = "contact@ -> owner's Gmail"
  enabled  = true
  priority = 0

  matchers = [{
    type  = "literal"
    field = "to"
    value = local.contact_address
  }]

  actions = [{
    type  = "forward"
    value = [cloudflare_email_routing_address.owner.email]
  }]

  depends_on = [cloudflare_email_routing_dns.korczak_xyz]
}
