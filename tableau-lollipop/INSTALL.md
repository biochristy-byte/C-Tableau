# Hosting the Lollipop viz extension

Everything needed is in this folder except one file. There is nothing to compile
and no package to install. The one file is Tableau's own Extensions API library,
which is not redistributed here: download it once into `lib/` (see
`lib/README.md`, it takes a minute). After that no internet connection is needed,
because Tableau does not publish the library to a CDN a sandboxed extension
could reach.

## What you need

| | |
| --- | --- |
| Tableau Desktop | 2024.2 or newer. The **free edition works**, verified on 2026.2 with no licence. |
| A web server | Anything that serves static files. Examples below. |
| Tableau Public | Works while you author in Public Desktop. Viewers of the published viz see "isn't currently supported" until Tableau approves the extension on the Exchange. See `README.md`. |

## 1. Check the port is free

Everything below uses port 8765. Check that nothing already has it, before
starting anything.

This is the most common way the setup goes wrong. A port already in use makes
the server either refuse to start or land somewhere else, and then the address
written in the manifest no longer matches where the files actually are. The
symptom is a blank chart, which looks like the extension is broken when it is
only pointed at the wrong door.

Windows PowerShell:

```powershell
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { "8765 is TAKEN, pick another" } else { "8765 is free" }
```

macOS or Linux:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN || echo "8765 is free"
```

If it is taken, pick another number between 1024 and 65535, say 8770, and use
that same number in all three places below: the server command, the address you
open in a browser, and the URL inside `lollipop.trex`. All three have to agree.

To see everything currently listening, rather than one port:

```powershell
Get-NetTCPConnection -State Listen | Sort-Object LocalPort | Select-Object LocalPort, OwningProcess
```

## 2. Serve this folder

The extension is a web page. Tableau loads it in a sandboxed frame, so it has
to come from a URL rather than a file path.

Plain HTTP is allowed **only** for `localhost`. Any other host must be HTTPS,
with a certificate the machine already trusts.

Pick whichever of these you already have:

```bash
npx http-server . -p 8765 -c-1 --cors
```

```bash
python -m http.server 8765
```

Then check that `http://localhost:8765/src/index.html` loads. It will be a
blank page. That is correct: the page draws nothing until Tableau gives it
data.

## 3. Point the manifest at your server

Open `lollipop.trex` in any text editor and edit the one URL in it:

```xml
<source-location>
  <url>http://localhost:8765/src/index.html</url>
</source-location>
```

It must be the address of `src/index.html` on your server. If you serve this
folder at `https://charts.example.com/lollipop/`, the URL becomes
`https://charts.example.com/lollipop/src/index.html`.

**Tableau reads this file only at the moment you add the extension.** Editing
it afterwards changes nothing until you remove the extension and add it again.

## 4. Add it to a worksheet

1. Build an ordinary worksheet first: one dimension and one measure, so there
   is something to draw. A bar chart is a good starting point.
2. On the Marks card, open the **mark type dropdown**, the one that says
   Automatic or Bar.
3. Scroll to **Viz Extensions**, then **Add Extension**.
4. In the dialog, choose **Access Local Viz Extensions** and pick your
   `lollipop.trex`.
5. Tableau shows an **Allow Extension** dialog naming the extension, its
   author, its URL, and that it wants full data access. Allow it.
6. The Marks card now has **Category**, **Value**, **Colour** and **Label**
   shelves. Put your dimension on Category and your measure on Value.

The gear appears in the top right corner of the viz. It fades when the pointer
is elsewhere, so move over the chart to see it.

## If the chart is blank

| What you see | What it means |
| --- | --- |
| Blank white area, no gear | The server is not running, or the URL in the `.trex` is wrong. Open that URL in a browser to check. |
| Server says the address is already in use | Something else holds that port. Go back to step 1, pick another, and change it in all three places. |
| "Drop a dimension on Category and a measure on Value" | Working correctly. It needs fields on those two shelves. |
| Extension never appears in the Marks dropdown | Tableau is older than 2024.2. In Tableau Public Desktop, open the Marks dropdown > Viz Extensions > Access Local Viz Extensions and pick `lollipop.trex`. |
| It worked, then went blank | The server stopped. The extension is a live web page, not a copy baked into the workbook. |
| Blank in a PDF or PowerPoint export | A Tableau platform limit for all viz extensions, not a fault here. |

## Sharing a workbook that uses it

Anyone opening the workbook needs the extension reachable at the same URL that
is written in the workbook. On `localhost` that means every person has to run
their own copy of the server. Hosting it once, on an HTTPS address everyone can
reach, is what makes a workbook openable by other people.

## Trying it without Tableau

Open `dev/dev.html` from the same server. It runs the exact code the extension
runs, against a mock of the Tableau API, with nine deliberately awkward
datasets and every setting live. Nothing about the chart or the settings panel
is faked there.

## What is in here

```
lollipop.trex        the manifest Tableau reads, and the file you edit
src/                 the extension itself
lib/                 where Tableau's Extensions API library goes (download it, see lib/README.md)
dev/                 mock Tableau API, fixtures, standalone harness
test/run.js          147 headless assertions, run with: node test/run.js
README.md            how it works and why it is built this way
```
