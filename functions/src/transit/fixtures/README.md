# The WTP feed fixtures

`impediment.xml` and `change.xml` are **reconstructions, not captures**, and that is a real
weakness worth stating rather than burying.

wtp.waw.pl is behind AWS WAF. Every request from this container — and from the machine any of this
was written on — comes back `HTTP 202`, `x-amzn-waf-action: challenge`, zero bytes. So the feeds
could not be saved the way `teatrWielki.html` was, and these files were assembled instead from what
*is* verifiable from outside the WAF:

- **The feed URLs** (`?post_type=impediment`, `?post_type=change`) are taken from the source of the
  community bot that has been reading them daily for months
  (codeberg.org/wojciech_space/wtp-fedi-bot), which uses `rss-parser` against exactly these two.
- **Every `<title>`, `<link>` and publication time below is real**, read back off that bot's public
  timeline, which posts each item's title and link verbatim. The metro items in particular
  (`Utrudnienia w komunikacji: M1`, `… 742, M1`) are the shape this app is built to recognise, and
  they are quoted rather than invented.
- **The `<content:encoded>` prose is written to be representative** — the phrasing WTP uses for a
  closure, a replacement bus, a reason and a date range. It is *not* a transcript.

What that means for the tests over these files: they prove the parser reads the envelope, the line
list, the CDATA and the dates correctly, and they prove the WAF-shaped failures are caught. They do
**not** prove the extractor's prompt copes with WTP's real sentences, and they cannot serve the
purpose the Teatr Wielki fixture serves — noticing the day the markup changes.

**Replace these with a real capture at the first opportunity.** From a machine the WAF does not
challenge:

```
curl -sS 'https://www.wtp.waw.pl/feed/?post_type=impediment' > impediment.xml
curl -sS 'https://www.wtp.waw.pl/feed/?post_type=change'     > change.xml
```

and delete this paragraph. Until then, `transitFeeds/{impediment,change}` on the Raw tab is the
only thing that will tell you the parser has stopped matching the real feed.
