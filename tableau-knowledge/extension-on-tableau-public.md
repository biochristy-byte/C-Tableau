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

## The no-script route: Viz pages on c-tableau.netlify.app

If your extension is approved on C-Tableau, C-Tableau can build the standalone page for you. You give it your data and your settings, and it gives you the address to paste into a Tableau Web Page object. Sections 1 to 4 below are then done for you.

1. Sign in at https://c-tableau.netlify.app/account/ and open **Viz pages**, then **New viz page**.
2. **Name your viz** (3 to 60 characters). The name becomes the address: `https://c-tableau-hosted.netlify.app/v/<name>/?embed=1`. The screen shows the final address as you type, and suggests `<name>-2` if the name is taken. The address is fixed once published, so links in Tableau never break.
3. **Pick the extension**: one of yours, or any public community extension if you have C-Tableau Unlimited.
4. **Upload your data**: in Tableau, View Data, Download, Summary tab. A CSV up to 5 MB. You see the first 10 rows.
5. **Map your columns**: one dropdown per encoding the extension asks for, read from its .trex. C-Tableau remembers your mapping for each extension.
6. **Paste your settings** (optional): in the extension's gear panel press Copy settings, then paste the JSON. If the extension stores its settings under a key prefix and the look does not match, fill in the prefix box.
7. **Preview**: the page renders at 1200x800, 800x600 and 400x700. Publish stays off until all three draw with no errors and no sideways scroll, and the screen says why while it is off.
8. **Publish** and copy the address. Then go to section 5, "Build the Tableau Public workbook": Web Page object, keep `?embed=1`, dashboard shading set to the page colour, the Image-object thumbnail fix, and File > Save to Tableau Public As (never Ctrl+S).

Free accounts get 3 live viz pages. C-Tableau Unlimited ($2 once) has no limit. Edit, unpublish and delete are on the Viz pages screen.

### With Claude or a script

Download `ctab.py` from https://c-tableau.netlify.app/api/ and make an API key in your account. Then:

```
python ctab.py vizpage publish --name "AI Garden" --extension <extension id> \
    --csv pisa_long.csv --settings pisa-dark-settings.json \
    --map flower=Country --map petal=Metric --map length=Value --map score="Science Score"
```

It prints the address to paste. `vizpage list`, `vizpage unpublish <slug>` and `vizpage delete <slug>` manage your pages, and `POST /api/v1/vizpages` does the same over HTTP. For Garden Petals, row order sets the order petals arrive in, so sort your CSV the way your workbook sent it if you want the same colours.

### What a viz page can run

The page swaps Tableau's library for a read-only stand-in. It runs extensions that read one worksheet's summary data, their encodings and their own settings. It cannot run extensions that need filters, parameters, several worksheets, dialogs or dashboard objects, or that write back to the workbook. Settings a visitor changes last for that visit only.

Prefer full control, or your extension is not on C-Tableau? The script route below works for any extension.

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

- **Poster (do this, or your Tableau Public card stays blank):** build once, run
  `python tools/make_poster.py poster.jpg standalone/ai-garden 1400 900` at your dashboard
  size, then build again with `--poster poster.jpg`. `--viz-title` sets the title drawn
  inside the viz. See "Fix the blank profile thumbnail" below for why.
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

Tableau Public makes **two different pictures** of a published viz, and they behave
differently with a Web Page object:

| Picture | Where | What it does with a Web Page object |
|---|---|---|
| Server render | `views/<Workbook>/<Dashboard>.png` | **Skips** it. Shows only what is under it |
| Gallery card (profile thumbnail) | `static/images/<2 letters>/<Workbook>/<Dashboard>/4_3.png` | **Loads your page** in a headless browser and screenshots it |

We proved the second one with a test workbook pointed at example.com: its card was a
picture of example.com. Turkey Trot's card was a live render too, drawn in a Linux font.

So the card needs **your page** to be screenshot-friendly:

1. **No outside requests.** A Google Fonts `<link>` that cannot be reached stops the
   page from ever finishing loading, and a screenshot then waits forever "for fonts to
   load". Inline the fonts (base64 woff2). `build_standalone.py` does this and goes RED if
   the page requests any outside URL.
2. **Open on a still if you draw on a canvas.** Plain HTML and SVG (Turkey Trot) were
   captured fine. AI Garden's animated canvas never made it into the card through five
   publishes. The fix that worked: the embedded page opens on a still image of the viz
   (built into the page). For a person the live canvas replaces it after its first frames
   with a 0.25 s fade. An automated browser (`navigator.webdriver` is true) keeps the still
   and the animation does not start. Add `?live=1` to run the live canvas in your own
   Playwright tests. Tools: `make_poster.py` captures the still, then rebuild.
3. **Optional: an Image object under the Web Page object** (same size, bitmap zone listed
   before the web zone in `<zones>`). It only fixes the server render, not the card, but it
   keeps `views/...png` from being blank. `add_thumb_layer.py` does it for a downloaded
   workbook (`https://public.tableau.com/workbooks/<Workbook>.twb` returns the packaged file).

Republish with the **same title** and answer Yes to "already exists. Overwrite it?" so the
URL stays. Verified 11/18/2026: AI Garden's card changed from Tableau's placeholder to the
viz about 2 minutes after the republish with step 2 live. Tableau Public's card for a
failed render is a plain grey placeholder, and that workbook's `1.png` is 1 x 1 pixel.

If you publish a test workbook to try this, **hide it from your profile right away** (and
delete it after): a public test shows up in your gallery.

**Second proof, 11/26/2026 (The Reef Gardeners, a scroll story with an animated WebGL
ocean):** the card rendered on the **first** publish. What the page did:

- **Every outside file is built into the page, scripts too, not just fonts.** We downloaded
  d3 once, checked it against the SRI hash cdnjs publishes, and put it inline. The build
  goes RED on any `<script src=`, any `<link href="http...">` or any `url(http`.
- **The still is an `<img>` over the whole page.** A one-line script at the top of `<body>`
  adds a `bot` class when `navigator.webdriver === true` and the URL has no `live=1`, and CSS
  shows the image (`position: fixed; inset: 0; object-fit: cover`) only under `.bot`. The
  page also turns motion off for that class.
- **The frame loop has to stop.** Our loop kept calling `requestAnimationFrame` with motion
  off because a timer flag stayed true, so it redrew 60 times a second forever. That is
  exactly what keeps a screenshot from settling. Test it: in an automated browser without
  `live=1`, count frames for 1.5 s. It must be 0.

### WebGL looks broken in Tableau Desktop, and works on Tableau Public

If your page draws with **WebGL** (a 3D scene, a shader background), **Tableau Desktop's
Web Page object shows it without the WebGL part**. Ours showed a flat blue gradient where
the sunset ocean should be. This is not a sign it will fail on Tableau Public.

- **Why:** Tableau Desktop shows web pages in its own built-in browser (QtWebEngine), and
  it starts that browser with `--use-gl=disabled` and `--disable-gpu-compositing`. So
  `canvas.getContext('webgl')` returns `null` there. You can see the flags yourself while a
  workbook with a Web Page object is open (PowerShell):
  `Get-CimInstance Win32_Process -Filter "Name='QtWebEngineProcess.exe'" | Select CommandLine`
- **On Tableau Public's website** the Web Page object is an ordinary `<iframe>` in the
  viewer's own browser, with `sandbox="allow-downloads allow-forms allow-modals
  allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox
  allow-presentation allow-same-origin allow-scripts allow-storage-access-by-user-activation"`
  (read from a live view 11/26/2026). WebGL runs there.
- **Check it before you publish:** open any published Tableau Public view in your browser,
  and in the developer console add an iframe with that same `sandbox` value pointing at
  your page, full screen. You see what a viewer will see. Ours showed the live sunset,
  and the published view matched.
- **Optional:** if you want Desktop's preview to look right too, draw a still image when
  `getContext('webgl')` returns `null` instead of leaving the background bare.

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
| Tableau Public gallery card stays a grey placeholder | The card is a headless screenshot of your page; a blocked font request or an animated canvas never reaches it | Inline fonts, no outside URLs, open on a still for `navigator.webdriver`, republish same title |
| `views/...png` render is blank | The server render skips Web Page objects | Image object of the viz under the Web Page object |
| A click meant for a dialog hit the viz | The OK button sat over the page | Close the panel it opened; viewer changes are not saved in the workbook |
| Page text vanished for a dark-mode viewer | Browser Auto Dark Mode darkened the background, not the SVG text | `color-scheme` meta tag and CSS on the page |
| Viewers stuck on slow Pages playback | Pages speed cannot be set or saved | Animate in the hosted page instead |
| Frame test said a letterboxed page overflowed | It measured the SVG box, not the drawing | Measure with `getScreenCTM()` |
| A claude.ai Artifact URL shows blank or refused in a Web Page object | claude.ai sends `frame-ancestors 'self'`, so only claude.ai itself may frame it | Host the same HTML on your own site (or a viz page) and put that URL in the object |
| WebGL background missing in Tableau Desktop (flat color where the 3D scene should be) | Desktop's built-in browser runs with `--use-gl=disabled`, so `getContext('webgl')` is null | Nothing to fix for Tableau Public: the published view runs in the viewer's browser, where WebGL works. Check in a browser (see "WebGL looks broken in Tableau Desktop") |
| Gallery card never settles even with fonts inlined | An outside `<script src>` (d3 from a CDN), or a frame loop that keeps running with motion off | Inline every script; stop `requestAnimationFrame` when nothing moves, and test 0 frames in 1.5 s for `navigator.webdriver` |
| A full-screen scroll-snap story does not snap | `overflow-x: hidden` on `body` makes body a scroll container, which silently kills `scroll-snap-type` on `html` | Use `overflow-x: clip` on `body` (it clips without creating a scroll container) |
