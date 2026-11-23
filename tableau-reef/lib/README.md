# Libraries in this folder

| File | What | Licence | In git |
| --- | --- | --- | --- |
| `d3-hierarchy.min.js` | d3-hierarchy 3.1.2 (circle packing) | ISC, `LICENSE-d3-hierarchy.txt` | yes |
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

`ctab-panel/` is the shared settings panel, an exact copy of `shared/ctab-panel/` (`python shared/ctab-panel/sync_check.py` fails if it drifts).
