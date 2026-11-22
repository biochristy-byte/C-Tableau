# Libraries

## Vendored here (committed, with licences)

| File | What | Version | Licence |
| --- | --- | --- | --- |
| `d3-array.min.js` | d3-array | 3.2.5 | ISC, `LICENSE-d3-array.txt` |
| `d3-contour.min.js` | d3-contour (`contourDensity`) | 4.0.3 | ISC, `LICENSE-d3-contour.txt` |
| `fonts/inter-latin-wght-normal.woff2` | Inter, latin subset, variable weight | 5.3.0 (Fontsource) | SIL OFL 1.1, `fonts/LICENSE-Inter-OFL.txt` |

Nothing loads from a CDN at runtime.

## Not here: the Tableau Extensions API library

`lib/tableau.extensions.1.latest.min.js` is Tableau's own file, so it is not
redistributed. Download it once from their official repo:

    curl -L -o lib/tableau.extensions.1.latest.min.js https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js

PowerShell:

    Invoke-WebRequest -Uri https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js -OutFile lib/tableau.extensions.1.latest.min.js

`.gitignore` keeps it out of git. The C-Tableau Viz pages flow does not need it: it
supplies its own stand-in. The dev harness and tests do not need it either.
