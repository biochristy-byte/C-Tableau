# Tableau Exchange submission: Garden Petals

Process (from the Extensions API page "Submitting your Extension to the Tableau Exchange"): you must
first be added as a contributor on the Exchange by emailing extensiongallery@tableau.com, then supply
the details below in the template they send. Review criteria, timeline and the "Works with Tableau
Public" requirements are not published there, so the email asks about them.

## Exchange card

| Field | Value |
| --- | --- |
| Extension name (1 to 3 words, must match the .trex) | Garden Petals |
| Icon (280x280 PNG, transparent) | `icon-280.png` |
| Manifest icon (70x70 PNG, base64) | embedded in `garden-petals-exchange.trex` (`icon-70.png`) |
| Tagline (96 characters max) | One flower per row, one petal per category, drawn as a garden. |

The tagline is 63 characters.

## Exchange page

**Description**

Garden Petals turns a worksheet into a garden of flowers. Put a dimension such as Country on Flower,
a second dimension such as Metric on Petal, and a measure on Length: each flower gets one petal per
category, and petal length shows the value. Switch between a grid, a garden map that plants each
flower at its location, and an altitude view. A grey outline on every flower shows a reference value
such as an average, petals past a threshold can glow or wilt, flowers with similar shapes are linked,
and a click opens a close-up bloom with the exact values. Everything is adjustable from a settings
panel inside the viz: colors, fonts, petal shape, labels, title and tooltips. It reads your data in the
browser and sends nothing anywhere.

**Developer info**

| Item | Value |
| --- | --- |
| Developer | Chris Fryar, Oxidative RN |
| Privacy policy | `PRIVACY.md` (needs a public link: https://github.com/biochristy-byte/C-Tableau/blob/main/tableau-garden-petals/exchange/PRIVACY.md once the repo is public) |
| Terms of service | `TERMS.md` (same folder, same link pattern) |
| Support | https://github.com/biochristy-byte/C-Tableau/issues and the repo README |
| Version | 1.0.0 |
| Source | https://github.com/biochristy-byte/C-Tableau (MIT) |
| Hosted at | https://garden-petals-viz.netlify.app/src/index.html |
| Permission | full data (needed to read the fields on the shelves) |

**Featured images (1200x680 PNG)**

| File | Shows |
| --- | --- |
| `featured-1-grid.png` | The grid view with the legend and "how to read" key |
| `featured-2-garden-dark.png` | The garden map on a dark theme, with twin links and a glow |
| `featured-4-bloom.png` | The close-up bloom with values against the reference |

All three use made-up sample numbers, so nothing sensitive is shown.

## Things to know before they review it

- The extension page loads three fonts from Google Fonts. If the Exchange requires everything to be
  self-hosted, the fonts need bundling first. The privacy policy discloses this.
- Hosting: the manifest points at a Netlify static site that serves `src/` and Tableau's own
  Extensions API library. Keep it up for as long as the extension is listed.
- Proven in Tableau Desktop 2026.2 and Public Desktop 2026.1. Not yet reviewed by Tableau.
