# Libraries

## Vendored here (committed, with licences)

| File | What | Version | Licence |
| --- | --- | --- | --- |
| `rough.js` | rough.js, the hand-drawn graphics library (bundled build) | 4.6.6 | MIT, `LICENSE-roughjs.txt` |
| `fonts/inter-latin-wght-normal.woff2` | Inter, latin subset, variable weight | Fontsource build | SIL OFL 1.1, `fonts/LICENSE-Inter-OFL.txt` |

Nothing loads from a CDN at runtime.

## Not here: the Tableau Extensions API library

`lib/tableau.extensions.1.latest.min.js` is Tableau's own file, so it is not
redistributed. Download it once from their official repo:

    curl -L -o lib/tableau.extensions.1.latest.min.js https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js

PowerShell:

    Invoke-WebRequest -Uri https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js -OutFile lib/tableau.extensions.1.latest.min.js

`.gitignore` keeps it out of git. The C-Tableau Viz pages flow does not need it: it
supplies its own stand-in. The dev harness and tests do not need it either.
