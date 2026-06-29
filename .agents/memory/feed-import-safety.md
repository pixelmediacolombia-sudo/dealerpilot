---
name: Feed import safety guard
description: Why the inventory importer must never apply a zero-parse feed, and how feed URLs are SSRF-guarded.
---

# Feed import safety

A feed that parses to **zero vehicles** must abort the import without mutating any
vehicle rows, and record the feed run as `error`.

**Why:** the importer marks every existing vehicle NOT seen in the current feed as
`Sold/Removed`. If a vendor returns a 200 with an HTML error page / shape-drifted
XML (parses to 0 vehicles), a naive import silently wipes the dealer's entire
active inventory and still records the run as `success`. A dealer selling every
car at once is not a real event; treat 0-parse as a broken feed.

**How to apply:** the guard lives at the top of `importFeed()` in
`artifacts/api-server/src/inventory/importFeed.ts`, right after parse and after the
`running` feed-run row is created. Keep any future "large drop" threshold guard in
the same place (e.g. parsed count drops far below previous active count → abort).

# Dealer feed URL SSRF guard

Dealer-supplied `xmlFeedUrl` is attacker-controllable and is fetched server-side.
`fetchFeedXml()` in `feedSource.ts` enforces http/https only, blocks
loopback/private/link-local/metadata hosts, and uses `redirect: "error"`.

**Why:** without it, `PATCH /api/dealers/:id` + sync is an SSRF primitive against
internal services / cloud metadata (169.254.169.254). Routes are currently
unauthenticated (sprint spike), which makes the guard the only protection.
