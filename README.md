# C-Tableau

Everything Chris and Claude learned building Tableau dashboards and viz extensions,
plus two working extensions you can run. Free, MIT licensed.

| I want to | Go to |
| --- | --- |
| Have Claude design or build Tableau work well | [`tableau-knowledge/`](tableau-knowledge/README.md). Point your Claude at it and say "read tableau-knowledge/README.md, then help me build a dashboard." |
| Rebuild the flower garden dashboard (MM 2026 week 44, PISA and AI) | [`tableau-garden-petals/example-pisa/`](tableau-garden-petals/example-pisa/README.md): data script, exact dark settings, shelf-by-shelf steps |
| Use or copy a viz extension | [`tableau-garden-petals/`](tableau-garden-petals/README.md) (flowers, three views) or [`tableau-lollipop/`](tableau-lollipop/README.md) (84 settings) |
| Submit an extension to the Tableau Exchange | [`tableau-garden-petals/exchange/`](tableau-garden-petals/exchange/SUBMISSION.md): manifest, icon, screenshots, privacy policy, terms and the contributor email |
| Stop a Tableau Public workbook from being published by accident | [`tableau-knowledge/never-ctrl-s-on-public.md`](tableau-knowledge/never-ctrl-s-on-public.md) |

Not included: Tableau's own Extensions API library (each extension's `lib/README.md` says how to
get it) and the Makeover Monday data (the PISA recipe says how to reshape it).

One thing to know before you publish: Tableau Public only runs Tableau-approved extensions, so a
workbook that uses your own self-hosted extension shows visitors "isn't currently supported". It
runs fine in Tableau Desktop, including Public Desktop while you author.
