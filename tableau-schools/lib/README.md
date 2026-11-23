# Libraries in this folder

| File | What | Licence | In git |
| --- | --- | --- | --- |
| `d3-force.min.js` | d3-force 3.0.0 (the settling simulation) | ISC, `LICENSE-d3-force.txt` | yes |
| `d3-dispatch.min.js` | d3-dispatch 3.0.1 (needed by d3-force) | ISC, `LICENSE-d3-dispatch.txt` | yes |
| `d3-quadtree.min.js` | d3-quadtree 3.0.1 (needed by d3-force) | ISC, `LICENSE-d3-quadtree.txt` | yes |
| `d3-timer.min.js` | d3-timer 3.0.1 (needed by d3-force) | ISC, `LICENSE-d3-timer.txt` | yes |
| `d3-hierarchy.min.js` | d3-hierarchy 3.1.2 (loaded for shared helpers) | ISC, `LICENSE-d3-hierarchy.txt` | yes |
| `tableau.extensions.1.latest.min.js` | Tableau's Extensions API | Tableau's own | **no, download it** |

## The Tableau Extensions API library

The extension needs `lib/tableau.extensions.1.latest.min.js`. It is Tableau's own
library, so it is not redistributed here. It takes a minute:

```bash
curl -L -o lib/tableau.extensions.1.latest.min.js https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js
```

On Windows PowerShell:

```powershell
Invoke-WebRequest -Uri https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js -OutFile lib/tableau.extensions.1.latest.min.js
```

Or open https://github.com/tableau/extensions-api/tree/main/lib and download the
raw file into this folder. The name must match exactly. Built and tested against
version 1.17.0; any `1.latest` build works.

`.gitignore` skips it so it stays on your machine. The tests do not need it (they
use a mock), and the C-Tableau Viz pages replace it with their own stand-in.
The d3 modules load in the order the page lists them; there is no CDN at runtime.

`ctab-panel/` is the shared settings panel, an exact copy of `shared/ctab-panel/` (`python shared/ctab-panel/sync_check.py` fails if it drifts).
