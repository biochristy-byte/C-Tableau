# Put your own viz extension on Tableau Public (the Web Page object route)

Tableau Public only runs extensions that Tableau has approved for the Exchange. A
workbook that uses your own extension publishes fine, but every visitor sees
"Extension <name> isn't currently supported on Tableau Public"
(see [`viz-extensions.md`](viz-extensions.md)).

The way around it: **run the extension as an ordinary web page, host the page, and
show it in a dashboard Web Page object.** Tableau Public is happy to frame a web page.
The method was shared by Eric Summers at a Tableau User Group session; this file is
the full recipe as we ran it on 11/18/2026 for *AI Garden* (the Garden Petals
extension, Makeover Monday 2026 week 44), live at
public.tableau.com/app/profile/c2fryar/viz/AIGarden/AIGarden.

Tools for every step are in
[`../tableau-garden-petals/tools/`](../tableau-garden-petals/tools/): `build_standalone.py`,
`standalone_test.py`, `make_thumbnail.py`, `tabdrive.py`.

## Where to host the extension itself: C-Tableau

**c-tableau.netlify.app** hosts viz extensions (the `.trex` manifest plus its page) over
HTTPS, so a manifest points at a real address instead of `localhost`.

| Plan | What you get |
|---|---|
| Free | 3 extensions |
| C-Tableau Unlimited, **$2 once** | Unlimited hosting, plus every public community extension. One payment, no subscription |

New extensions are private (only you can load them) until you set one to public. Every
upload waits for approval, and each extension can hold up to 300 files and 30 MB.
Sign in with your email, or use an API key from the account page for scripts.

Hosting fixes the address. It does not change Tableau Public's rule: viewers there still
see "isn't currently supported" until the extension is Exchange-approved. So use the
hosted extension in Tableau Desktop, Server and Cloud, and use the route below on Public.

## The route in one picture

```
your extension code  ->  standalone page (extension + stand-in API + your data + your settings)
                     ->  hosted on any HTTPS site
                     ->  Tableau dashboard: one Web Page object pointing at it
                     ->  Save to Tableau Public
```

## 1. Build the standalone page

The extension's `viz.js` talks to `tableau.extensions`. The build script inlines the
extension code and adds a small read-only stand-in for that API, which serves your CSV
rows shaped exactly like Tableau's summary data (`SUM(Value)` and so on). The extension
runs unchanged and never knows Tableau is missing.

```
cd tableau-garden-petals
python tools/build_standalone.py --data example-pisa/pisa_long.csv \
    --settings example-pisa/pisa-dark-settings.json --title "AI Garden" \
    --url https://your-site/vizzes/ai-garden/ --image https://your-site/vizzes/images/ai-garden.jpg \
    --exit-href /vizzes/ --out standalone/ai-garden/index.html
```

- **Settings:** in Tableau, open the extension's gear panel, click **Copy settings**, and
  save that JSON. The page starts in exactly your look.
- **Row order matters.** Petal colors follow the order each metric first arrives, so the
  script sorts rows in the same order your workbook sent them (`PETAL_ORDER`). Change it
  for other data, or your colors will not match your Tableau view.
- **Row and flower counts are a gate.** The script stops RED if the CSV does not give the
  expected rows and flowers (`--expect-rows`, `--expect-flowers`).
- **Viewer controls stay.** The settings gear and panel ship with the page. A visitor's
  changes last only for their visit.
- **Exit button.** When the page is opened on its own, a small Exit pill shows at the top
  left (`--exit-href`). Inside a frame it hides itself. Tableau Desktop's Web Page object is
  **not** a frame (`window.top === window` there), so the page also hides Exit when the
  URL has `?embed=1`. Always put `?embed=1` on the URL you paste into Tableau.

## 2. Test it the way Tableau frames it

```
python tools/standalone_test.py                       # the local build
python tools/standalone_test.py https://your-site/... # the deployed page
```

It loads the page inside an iframe at 7 sizes (1200x800 down to 400x700, plus very
wide and very tall) and checks, at each: no sideways scroll, 0 console errors, every row
and flower drawn, every country placed, the gear present, Exit hidden, the canvas
actually painted. Then it opens the page on its own at desktop and phone width and checks
that Exit shows at the top left without covering the chart. It prints how many checks it
examined and goes RED below 9 of 9. Look at the screenshots in `shots/standalone/` too.

## 3. Host it

Any static HTTPS host works: your own site, Netlify, GitHub Pages. Upload the one
`index.html`. Test the live URL with `standalone_test.py <url>` before you touch Tableau.

## 4. Thumbnail and link preview

```
python tools/make_thumbnail.py ai-garden.jpg
```

1280 x 790, captured with `?embed=1` after the animation settles. It refuses to write an
image that is mostly white or mostly empty, so a dark viz never gets a blank or light
placeholder card. Upload it to the `--image` address so link previews show the real viz.

## 5. Build the Tableau Public workbook

1. **Data.** Tableau Public publishes a workbook with a data source, so connect a tiny CSV.
   Ours was one row: a column `Viz` with the value `AI Garden`. (We did not test publishing
   with no data source at all.)
2. **New dashboard** from the **Dashboard** menu > New Dashboard. The tab-bar icons shift
   as tabs are added; clicking by position once made a Story instead. If that happens,
   right-click the Story tab > Delete.
3. **Size:** Size dropdown > **Fixed size**, then type the width and height. We started at
   1200 x 800 and went to **1400 x 900** for a bigger map. Tableau Public scales a fixed
   dashboard down on small screens.
4. **Web Page object:** Objects list (scroll down) > double-click **Web Page**. Paste your
   URL **with `?embed=1`**, press Enter. The page renders right in the dashboard.
5. **Remove the white edge.**
   - Select the web object > **Layout** tab > Outer Padding > set all sides to 0.
   - Tableau still keeps an 8 px gap at the dashboard edge. **Format > Dashboard >
     Dashboard Shading > More colors** > type the page's background hex (ours `#0a1619`).
     The gap now matches the viz.
6. **Name things.** Right-click the dashboard tab > Rename (ours: "AI Garden"). Delete any
   extra Story or empty tabs you made by accident.
7. **Publish:** in Tableau Public 2026.1 it is under **File > Save to Tableau Public As...**
   (the Server menu only has Run Optimizer). Type the workbook title, click Save.
   **Never press Ctrl+S in Tableau Public**: it publishes (see
   [`never-ctrl-s-on-public.md`](never-ctrl-s-on-public.md)).

Text looks larger inside local Tableau than on the web on a 150% display: local Tableau
scales fonts with Windows, Tableau Public web does not. Judge the layout from the
standalone test's screenshots or the published view, not from the Desktop canvas.

## 6. Check the published viz

Open `https://public.tableau.com/views/<Workbook>/<Dashboard>?:showVizHome=no&:embed=y`
in a clean browser and confirm the inner frame loads your page and the chart draws.
Then write the description on the Tableau Public page.

### Fix the blank profile thumbnail

Tableau Public draws the gallery thumbnail on its own servers, and that renderer
**skips Web Page objects**. A dashboard that is only a Web Page object gets a blank card
(white, grey or an empty dark box). Check it: `views/<Workbook>/<Dashboard>.png` is the
server's render.

Fix: put a still picture of the viz **under** the Web Page object.

1. Screenshot the hosted page with `?embed=1` at the exact dashboard size (ours 1400 x 900).
2. Add an **Image** object at full size, then the Web Page object at full size on top of it.
   Floating both at x 0, y 0 works. In the `.twb` XML the order inside `<zones>` is the
   stacking order: the `type-v2='bitmap'` zone first, the `type-v2='web'` zone after it.
3. Republish with the **same title** and answer Yes to "already exists. Overwrite it?" The
   URL stays the same.

Viewers still see the live page (the picture is hidden underneath), and the server render
shows the picture. Verified 11/18/2026 on AI Garden and MOM 46 Turkey Trot: the server
render went from blank to the viz, and the live iframe is still the top element at the
center of the view. The gallery card (`static/images/.../4_3.png`) is cached and updates
later than the render.

`tableau-garden-petals/tools/add_thumb_layer.py` does step 2 for a downloaded workbook
(`https://public.tableau.com/workbooks/<Workbook>.twb` returns the packaged file).

## 7. Link it back

If your site has a viz gallery, add the Tableau Public link to the viz's card so people
can find it either way.

## Animated vizzes: why this route beats the Pages shelf

The same route works for any hand-built HTML viz, not just an extension. We used it on
11/18/2026 for *MOM 46 Turkey Trot* (Makeover Monday week 46), an animated map of turkey
exports, after first building it the Tableau-native way with the Pages shelf.

**What the Pages shelf cannot do (Tableau Public 2026.1, checked in the app's own files):**

- **No speed setting.** The Pages card zone (`type-v2='currpage'`) only knows `looped`,
  `dropdown`, `slider`, `playctrls`, `synchronized` and `trailctrls`. There is no speed
  attribute, and the speed a viewer picks is not saved in the workbook.
- **Every viewer starts on normal speed**, about 1 page per second. Fast is about 10 pages
  per second. You can tell viewers to pick fast, but you cannot pick it for them.
- **You cannot hide just the speed buttons.** `playctrls='0'` hides the play button too.
- **Marks jump, they do not glide.** Pages playback in Desktop never tweens marks between
  pages, with animations on or off. Smooth motion needs many small steps, which makes the
  movement slow.

A Web Page object showing the hosted HTML runs at the browser's 60 frames per second,
starts on its own, and needs no speed buttons. On the published Turkey Trot viz the framed
page measured a steady 16.7 ms per frame (worst 16.9 ms) on Tableau Public's website.

**Extra steps for a hand-built page:**

1. **Make it fit any frame.** Draw at a fixed design size (ours an SVG with
   `viewBox='0 0 1600 1000'`) and let it scale: `body > svg { width: 100vw; height: 100vh }`.
   The default `preserveAspectRatio` letterboxes it. At the dashboard's exact size it is 1:1.
2. **Declare the color scheme.** Add `<meta name="color-scheme" content="light dark">` and
   `:root { color-scheme: light dark }`. Without it, Chrome's Auto Dark Mode (and some
   Android browsers) darken the page background but not the SVG text, and the text
   disappears for anyone with dark mode on. The page keeps its own colors once it declares
   a scheme. Set every background and text color yourself so nothing falls back to the
   browser default.
3. **Hide standalone-only buttons on `?embed=1`**, the same as the Exit pill above.
4. **Keep your real data as the data source.** Instead of a one-row placeholder, we kept the
   viz's own data in the workbook on hidden sheets, so anyone who downloads it gets the
   data behind the picture. Published fine.

**Building the workbook in XML instead of clicking:** the Web Page object is one zone.

```xml
<zone h='100000' w='100000' x='0' y='0' id='2'
      param='https://your-site/vizzes/your-viz/?embed=1' type-v2='web'>
```

`h`, `w`, `x` and `y` are in 1/100000 of the dashboard, so this fills a fixed-size
dashboard edge to edge. Put the thumbnail Image zone before it (see "Fix the blank profile
thumbnail" above).

**Testing tips for a framed animation:**

- Measure the drawn area with `svg.getScreenCTM()`, not the SVG's box. A letterboxed SVG's
  box is the whole window, so a box check passes or fails for the wrong reason.
- Check smoothness from `requestAnimationFrame` gaps after about 10 warm-up frames
  (median near 16.7 ms, worst under 50 ms). One run with a single 50 ms gap that clears on
  the next run is the test machine, not the page. A real stutter shows up every run.
- **Test forced dark mode headlessly.** Launch Chromium or Edge with
  `--enable-features=WebContentsForceDark --force-dark-mode
  --blink-settings=forceDarkModeEnabled=true` and a dark color scheme, then read a
  background pixel. Run it on the page without the color-scheme tag first: the test must
  go RED there (ours read the paper as dark brown) before you trust its GREEN.

## Driving Tableau with a script (optional)

`tools/tabdrive.py` drives Tableau by screenshots and clicks, one step at a time.

- When more than one workbook is open, set `TAB_TITLE` to the target window's title.
  The driver then acts only on that window, brings it to the front before any click or
  key, and refuses to run if it cannot find it, so it never clicks into another workbook.
- `rxy` right-clicks (tab menus).
- It refuses Ctrl+S and Alt+F+S outright.
- **See a Tableau window without taking it over.** Windows `PrintWindow(hwnd, dc, 2)` (the
  2 is `PW_RENDERFULLCONTENT`) captures one window even when another window is on top of
  it, so you can check a workbook while someone keeps working in theirs.

## Gotchas we hit

| What happened | Why | Fix |
|---|---|---|
| Exit button showed inside Tableau Desktop | Desktop's web object is not an iframe | `?embed=1` on the URL, page hides Exit on that flag |
| 8 px white strip right and bottom | Dashboard edge padding outside the object | Dashboard shading = page background color |
| A Story tab appeared | Tab-bar icons shift position | Use the Dashboard menu; delete the stray tab |
| No publish item under Server | 2026.1 moved it | File > Save to Tableau Public As |
| Petal colors did not match the Tableau view | Colors follow row arrival order | Sort rows in the workbook's order |
| Thumbnail showed a white page | Captured an older, light version | `make_thumbnail.py` refuses light images |
| Tableau Public gallery thumbnail blank | Its server render skips Web Page objects | Image object of the viz under the Web Page object, republish same title |
| A click meant for a dialog hit the viz | The OK button sat over the page | Close the panel it opened; viewer changes are not saved in the workbook |
| Page text vanished for a dark-mode viewer | Browser Auto Dark Mode darkened the background, not the SVG text | `color-scheme` meta tag and CSS on the page |
| Viewers stuck on slow Pages playback | Pages speed cannot be set or saved | Animate in the hosted page instead |
| Frame test said a letterboxed page overflowed | It measured the SVG box, not the drawing | Measure with `getScreenCTM()` |
