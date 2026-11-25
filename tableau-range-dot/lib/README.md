# The Tableau Extensions API library

Range Dot needs one file that is not in this folder:

    lib/tableau.extensions.1.latest.js

It is Tableau's own library, so it is not redistributed here. Without it the page loads but never
connects to Tableau, and the chart stays blank. The browser preview (`index.html?preview=1`) does
not need it.

## Get it

Tableau publishes it in the `lib` folder of its official extensions-api repository:

https://github.com/tableau/extensions-api/tree/main/lib

1. Open that page and click `tableau.extensions.1.latest.js`. Range Dot loads the plain file, not
   the `.min.js` one.
2. Click the download icon on the file view ("Download raw file").
3. Save it into this folder, so the full path is
   `tableau-range-dot/lib/tableau.extensions.1.latest.js`.
