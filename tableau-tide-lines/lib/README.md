# The Tableau Extensions API library

`tableau.extensions.1.latest.min.js` is Tableau's own library (MIT, from
https://github.com/tableau/extensions-api/tree/main/lib). It is committed here so the
extension never depends on a CDN at runtime. Tide Lines needs no other library: the
density maths, layout and drawing are our own code in `src/js`.

To refresh it:

    curl -L -o lib/tableau.extensions.1.latest.min.js https://raw.githubusercontent.com/tableau/extensions-api/main/lib/tableau.extensions.1.latest.min.js
