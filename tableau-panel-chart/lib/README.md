# The Tableau Extensions API library

`tableau.extensions.1.latest.min.js` is Tableau's own library (MIT, from
https://github.com/tableau/extensions-api/tree/main/lib). It is committed here so the
extension never depends on a CDN at runtime. Panel Chart needs no other library: the
scales, layout and drawing are our own code in `src/js`. `ctab-panel/` is the shared settings panel, an exact copy
of `shared/ctab-panel/` (`python shared/ctab-panel/sync_check.py` fails if it drifts).

To refresh it:

    curl -L -o lib/tableau.extensions.1.latest.min.js https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js
