"""Frame-test the standalone AI Garden at seven sizes, the way a Tableau Web Page object frames it.

  python tools/standalone_test.py                        local build at standalone/ai-garden/index.html
  python tools/standalone_test.py standalone/my-viz      another local build folder
  python tools/standalone_test.py https://...            a deployed URL

Per framed size: no sideways scroll, 0 console errors, the engine read 437 rows into 91 flowers
(set EXPECT_ROWS / EXPECT_FLOWERS for other data), every country placed on the map, no adapter
errors, the settings gear present, the Exit button hidden, the chart drawn (non-background pixels).
Opened on its own: Exit shows top left, links somewhere, and sits clear of the chart.
Screenshots go to shots/standalone/.
"""
import os, sys, json, threading, http.server, socketserver, functools, pathlib

EXPECT_ROWS = int(os.environ.get("EXPECT_ROWS", "437"))
EXPECT_FLOWERS = int(os.environ.get("EXPECT_FLOWERS", "91"))

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "shots" / "standalone"
SIZES = [(1200, 800), (1000, 700), (800, 600), (600, 900), (400, 700), (1600, 500), (1400, 2000)]

PROBE = """() => {
  const de = document.documentElement, g = window.__gp || {}, st = g.state || {};
  const cv = [...document.querySelectorAll('canvas')].map(c => ({w: c.width, h: c.height, cw: Math.round(c.getBoundingClientRect().width)}));
  let painted = 0;
  const big = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (big) {
    const x = big.getContext('2d'), d = x.getImageData(0, 0, big.width, big.height).data;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0 && (Math.abs(d[i] - 13) + Math.abs(d[i + 1] - 29) + Math.abs(d[i + 2] - 33)) > 60) painted++;
  }
  return {iw: innerWidth, ih: innerHeight, sw: de.scrollWidth, sh: de.scrollHeight,
          rows: st.rows, flowers: st.flowers, geoMiss: (st.geoMiss || []).length, adapterErrors: (st.errors || []).slice(0, 3),
          gear: !!document.querySelector('.gs-gear'),
          exitShown: (() => { const e = document.querySelector('.dd-exit'); return !!e && getComputedStyle(e).display !== 'none'; })(),
          title: document.title, canvases: cv, painted: painted};
}"""


def main():
    srv = None
    if len(sys.argv) > 1 and sys.argv[1].startswith("http"):
        url = sys.argv[1]
    else:
        folder = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "standalone" / "ai-garden"
        if not (folder / "index.html").exists():
            print("SKIP: no %s; build first with python tools/build_standalone.py" % (folder / "index.html"))
            return 2
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder.parent))
        h.log_message = lambda *a, **k: None
        srv = socketserver.TCPServer(("127.0.0.1", 0), h)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = "http://127.0.0.1:%d/%s/" % (srv.server_address[1], folder.name)
    OUT.mkdir(parents=True, exist_ok=True)
    base = url
    url = url + ("&" if "?" in url else "?") + "live=1"   # Playwright sets navigator.webdriver; live=1 = behave as for a person
    print("framing:", url)
    bad, seen = 0, 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for (w, hgt) in SIZES:
            ctx = b.new_context(viewport={"width": w + 40, "height": hgt + 40})
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m, e=errs: e.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda x, e=errs: e.append(str(x)))
            pg.set_content("<body style='margin:20px;background:#888'><iframe src='%s' style='width:%dpx;height:%dpx;border:0'></iframe></body>" % (url, w, hgt))
            pg.wait_for_timeout(3500)
            fr = [f for f in pg.frames if f != pg.main_frame]
            m = fr[0].evaluate(PROBE) if fr else {"fail": "no frame"}
            m["size"], m["errors"] = "%dx%d" % (w, hgt), errs[:3]
            ok = (not m.get("fail") and m["sw"] <= m["iw"] + 1 and not errs and m["rows"] == EXPECT_ROWS and m["flowers"] == EXPECT_FLOWERS
                  and m["geoMiss"] == 0 and not m["adapterErrors"] and m["gear"] and not m["exitShown"] and m["painted"] > 200)
            seen += 1
            bad += 0 if ok else 1
            print(("ok  " if ok else "RED ") + json.dumps(m))
            pg.screenshot(path=str(OUT / ("frame_%dx%d.png" % (w, hgt))))
            ctx.close()
        # opened on its own page: Exit shows top left, points at the gallery, and sits clear of the chart
        for (w, hgt) in [(1280, 800), (400, 700)]:
            ctx = b.new_context(viewport={"width": w, "height": hgt})
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda x, e=errs: e.append(str(x)))
            pg.goto(url)
            pg.wait_for_timeout(3000)
            s = pg.evaluate("""() => { const e = document.querySelector('.dd-exit'), r = e.getBoundingClientRect(),
                root = document.getElementById('root').getBoundingClientRect(), g = document.querySelector('.gs-gear');
                const gr = g ? g.getBoundingClientRect() : null;
                return {shown: getComputedStyle(e).display !== 'none', href: e.getAttribute('href'), left: r.left, top: r.top,
                        bottom: r.bottom, rootTop: root.top, gearRight: gr ? gr.right : null, gearTop: gr ? gr.top : null, iw: innerWidth}; }""")
            ok = (s["shown"] and s["href"] and s["left"] < 40 and s["top"] < 40 and s["bottom"] <= s["rootTop"]
                  and s["gearRight"] is not None and s["gearRight"] > s["iw"] - 80 and not errs)
            seen += 1
            bad += 0 if ok else 1
            print(("ok  " if ok else "RED ") + "solo %dx%d " % (w, hgt) + json.dumps(s) + (" errors=%s" % errs[:2] if errs else ""))
            pg.screenshot(path=str(OUT / ("solo_%dx%d.png" % (w, hgt))))
            ctx.close()
        # the poster (built with --poster): a still until the live canvas draws; automated browsers keep it
        emb = base + ("&" if "?" in base else "?") + "embed=1"
        extra = 0
        for who in ("bot", "person"):
            ctx = b.new_context(viewport={"width": 1400, "height": 900})
            pg = ctx.new_page()
            errs = []
            pg.on("pageerror", lambda x, e=errs: e.append(str(x)))
            if who == "person":   # a real visitor's browser reports navigator.webdriver false
                pg.add_init_script("Object.defineProperty(Navigator.prototype, 'webdriver', {get: () => false})")
            pg.goto(emb, wait_until="load")
            first = pg.evaluate("() => { const p = document.getElementById('dd-poster'); return !!p && p.complete && p.naturalWidth > 0 }")
            if who == "bot" and not first:
                print("note: page has no poster (build with --poster); poster checks skipped")
                ctx.close()
                break
            extra += 1
            pg.wait_for_timeout(4000)
            s = pg.evaluate("""() => { const p = document.getElementById('dd-poster'), r = p && p.getBoundingClientRect();
                return {poster: !!p, opacity: p ? getComputedStyle(p).opacity : null, covers: !!r && r.width >= innerWidth && r.height >= innerHeight,
                        flowers: window.__gp && window.__gp.state ? window.__gp.state.flowers : null}; }""")
            if who == "bot":   # the engine must stay stopped: the canvas does not change
                s["canvasStill"] = pg.evaluate("() => new Promise(r => { const c = document.querySelector('#root canvas'), x = c.getContext('2d');"
                                               " const sum = () => x.getImageData(0, 0, c.width, c.height).data.reduce((s, v, i) => i % 97 ? s : s + v, 0);"
                                               " const a = sum(); setTimeout(() => r(a === sum()), 1500); })")
                ok = s["poster"] and s["covers"] and s["opacity"] == "1" and s["canvasStill"] and not errs
            else:
                ok = first and not s["poster"] and s["flowers"] == EXPECT_FLOWERS and not errs
            seen += 1
            bad += 0 if ok else 1
            print(("ok  " if ok else "RED ") + "poster/%s " % who + json.dumps(s) + (" errors=%s" % errs[:2] if errs else ""))
            pg.screenshot(path=str(OUT / ("poster_%s.png" % who)))
            ctx.close()
        b.close()
    if srv:
        srv.shutdown()
    want = len(SIZES) + 2 + extra
    print("checks examined: %d of %d (7 framed sizes + 2 solo%s) | failing: %d" % (seen, want, " + 2 poster" if extra else "", bad))
    print("GREEN" if seen == want and not bad else "RED")
    return 0 if seen == want and not bad else 1


if __name__ == "__main__":
    sys.exit(main())
