"""Neurons render gates (Playwright, headless Chromium, foreground).

  python test/render.py              run every gate, print counts, exit 1 on any RED
  python test/render.py --shots DIR  also write a screenshot per case into DIR

Gates, each with a minimum subject count (RED below it, never a silent pass):
  A  mock render at 300x300, 900x600, 1600x1000 in dark and light:
     canvas painted, one dot per node, 0 console errors, no label overlaps (rotated
     rectangles taken from the DOM, not from the layout code), labels inside the frame,
     every text node >= 14px, label text >= 7:1 on the painted background, no
     horizontal scroll, the note present exactly when labels were left out.
  B  hover: eased fade (monotone, intermediate frames, no jumps), outgoing and
     incoming lit in two colours, the rest dimmed, node classes, readout, release.
  C  click / selection / hover pushed to the mock Tableau API.
  D  settings panel: stepper typed + saved as a string, survives reload, copy/paste,
     no sliders, no dialogs, panel text >= 14px and >= 7:1.
  E  data shapes: tiny, ungrouped, weird, empty, big, shelves removed, resize.
  F  the Viz pages stand-in (the real standin.js from the hub repo) drives it.
"""
import sys, os, json, math, csv, threading, http.server, socketserver, functools, pathlib, time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
STANDIN = pathlib.Path("C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js")
SHOTS = None
if "--shots" in sys.argv:
    SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]).resolve()
    SHOTS.mkdir(parents=True, exist_ok=True)

results = []   # (gate, subjects, [fail messages])
cur = None


class Gate:
    def __init__(self, name, minimum):
        self.name, self.minimum, self.subjects, self.fails = name, minimum, 0, []

    def ok(self, cond, msg):
        self.subjects += 1
        if not cond:
            self.fails.append(msg)

    def close(self):
        if self.subjects < self.minimum:
            self.fails.append("RED: examined %d subjects, minimum is %d" % (self.subjects, self.minimum))
        results.append(self)
        print(("RED  " if self.fails else "ok   ") + self.name + "  (%d subjects)" % self.subjects)
        for f in self.fails[:8]:
            print("       - " + f)


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    h = functools.partial(Quiet, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


def lum(rgb):
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def rgb_of(s):
    s = s.strip()
    if s.startswith("#"):
        s = s[1:]
        return [int(s[i:i + 2], 16) for i in (0, 2, 4)]
    nums = [float(x) for x in s[s.index("(") + 1:s.index(")")].replace("/", ",").replace(" ", ",").split(",") if x != ""]
    return nums[:3]


def sat_overlap(a, b):
    def axes(c):
        out = []
        for i in range(4):
            x1, y1 = c[i]
            x2, y2 = c[(i + 1) % 4]
            out.append((-(y2 - y1), x2 - x1))
        return out
    for ax in axes(a) + axes(b):
        pa = [p[0] * ax[0] + p[1] * ax[1] for p in a]
        pb = [p[0] * ax[0] + p[1] * ax[1] for p in b]
        if max(pa) <= min(pb) + 1e-6 or max(pb) <= min(pa) + 1e-6:
            return False
    return True


COLLECT = """() => {
  const q = s => [...document.querySelectorAll(s)];
  const labels = q('text.nx-label').map(t => {
    const b = t.getBBox(), m = t.getScreenCTM();
    const pt = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    return { id: t.parentNode.parentNode.getAttribute('data-id'), text: t.textContent,
      corners: [pt(b.x, b.y), pt(b.x + b.width, b.y), pt(b.x + b.width, b.y + b.height), pt(b.x, b.y + b.height)],
      fs: parseFloat(getComputedStyle(t).fontSize), fill: getComputedStyle(t).fill };
  });
  const gnames = q('text.nx-gname').map(t => {
    const r = t.getBoundingClientRect();
    return { text: t.textContent, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, fs: parseFloat(getComputedStyle(t).fontSize), fill: getComputedStyle(t).fill };
  });
  const host = document.getElementById('nx-chart');
  const note = q('.nx-note').filter(n => !n.hidden).map(n => { const r = n.getBoundingClientRect(); return { text: n.textContent, top: r.top, bottom: r.bottom, fs: parseFloat(getComputedStyle(n).fontSize), color: getComputedStyle(n).color }; })[0] || null;
  const cv = q('canvas.nx-canvas')[0];
  let painted = 0;
  if (cv && cv.width > 2) {
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
    const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(cv, 0, 0);
    const d = x2.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 13) if (d[i] > 20) painted++;
  }
  const arcs = q('path.nx-arc').map(a => { const r = a.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  const dots = q('circle.nx-dot').length;
  const de = document.documentElement;
  const allText = q('text, .nx-note, .nx-readout, .nx-empty').filter(e => !e.hidden && e.textContent.trim()).map(e => parseFloat(getComputedStyle(e).fontSize));
  const a = window.NX && window.NX.app ? window.NX.app.state.view.inspect() : null;
  return { labels, gnames, note, painted, canvas: cv ? [cv.width, cv.height] : null, dots, arcs,
    bg: getComputedStyle(host).backgroundColor, hscroll: de.scrollWidth > innerWidth + 1, vscroll: de.scrollHeight > innerHeight + 1,
    iw: innerWidth, ih: innerHeight, allText, plan: a && a.plan, dialogs: window.__audit ? window.__audit.dialogs : -1,
    nodes: window.NX && window.NX.app.state.model.graph ? window.NX.app.state.model.graph.nodes.length : -1,
    ranges: q('input[type=range]').length };
}"""


def new_page(b, url, w, h, errs, scheme="light"):
    ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, permissions=["clipboard-read", "clipboard-write"])
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.on("requestfailed", lambda r: errs.append("requestfailed: " + r.url))
    pg.on("response", lambda r: errs.append("http %d: %s" % (r.status, r.url)) if r.status >= 400 else None)
    pg.goto(url)
    return ctx, pg


def wait_idle(pg, ms=1100):
    pg.wait_for_function("() => window.NX && NX.app.state.ready && NX.app.state.view.planned", timeout=8000)
    pg.wait_for_timeout(ms)


def gate_a(b, base):
    g = Gate("A render: 3 sizes x light/dark", 400)
    for (w, h) in [(300, 300), (900, 600), (1600, 1000)]:
        for theme, bg in [("dark", None), ("light", "ffffff")]:
            tag = "%dx%d %s" % (w, h, theme)
            errs = []
            url = "%s/test/page.html?w=%d&h=%d&fx=worm" % (base, w, h) + ("&bg=" + bg if bg else "")
            ctx, pg = new_page(b, url, w, h, errs, "light")
            wait_idle(pg)
            r = pg.evaluate(COLLECT)
            if SHOTS:
                pg.screenshot(path=str(SHOTS / ("A_%s.png" % tag.replace(" ", "_"))))
            g.ok(not errs, tag + ": console errors " + str(errs[:3]))
            g.ok(r["painted"] > 300, tag + ": canvas painted %d samples" % r["painted"])
            g.ok(r["dots"] == r["nodes"] == 128, tag + ": %d dots for %d nodes" % (r["dots"], r["nodes"]))
            g.ok(not r["hscroll"] and not r["vscroll"], tag + ": no scroll (%s)" % ((r["iw"], r["ih"]),))
            bgc = rgb_of(r["bg"])
            if theme == "light":
                g.ok(all(c > 240 for c in bgc), tag + ": worksheet white respected, got " + r["bg"])
            else:
                g.ok(lum(bgc) < 0.05, tag + ": navy when Tableau gives no background, got " + r["bg"])
            # labels
            n = len(r["labels"])
            g.ok(n > 0 if w > 300 else True, tag + ": %d labels drawn" % n)
            plan = r["plan"]
            g.ok(plan["shown"] == n, tag + ": plan says %s labels, DOM has %d" % (plan["shown"], n))
            for lb in r["labels"]:
                g.ok(lb["fs"] >= 14, tag + ": label %s is %spx" % (lb["id"], lb["fs"]))
                c = contrast(rgb_of(lb["fill"]), bgc)
                g.ok(c >= 7, tag + ": label %s contrast %.2f" % (lb["id"], c))
                xs = [p[0] for p in lb["corners"]]
                ys = [p[1] for p in lb["corners"]]
                g.ok(min(xs) >= -0.5 and max(xs) <= r["iw"] + 0.5 and min(ys) >= -0.5 and max(ys) <= r["ih"] + 0.5, tag + ": label %s inside the frame" % lb["id"])
            for i in range(n):
                for j in range(i + 1, n):
                    g.ok(not sat_overlap(r["labels"][i]["corners"], r["labels"][j]["corners"]), tag + ": labels %s and %s overlap" % (r["labels"][i]["id"], r["labels"][j]["id"]))
            for gn in r["gnames"]:
                g.ok(gn["fs"] >= 14 and contrast(rgb_of(gn["fill"]), bgc) >= 7, tag + ": group name %s %spx" % (gn["text"], gn["fs"]))
                g.ok(gn["x0"] >= -1 and gn["y0"] >= -1 and gn["x1"] <= r["iw"] + 1 and gn["y1"] <= r["ih"] + 1, tag + ": group name %s inside the frame %s" % (gn["text"], [round(gn[k]) for k in ("x0", "y0", "x1", "y1")]))
            g.ok(all(f >= 14 for f in r["allText"]) and len(r["allText"]) > 0, tag + ": smallest text %s of %d nodes" % (min(r["allText"] or [0]), len(r["allText"])))
            g.ok(r["dialogs"] == 0, tag + ": no browser dialogs")
            # note
            left_out = 128 - plan["shown"]
            g.ok((r["note"] is not None) == (left_out > 0 or plan["clipped"] > 0 or "left off" in (plan["note"] or "")), tag + ": note present iff something was left out (hidden %d)" % left_out)
            if r["note"]:
                g.ok(r["note"]["fs"] >= 14, tag + ": note text %spx" % r["note"]["fs"])
                g.ok(contrast(rgb_of(r["note"]["color"]), bgc) >= 7, tag + ": note contrast")
                g.ok(r["note"]["bottom"] <= r["ih"] + 1 and r["note"]["top"] >= 0, tag + ": note inside the frame")
                lowest = max([a[3] for a in r["arcs"]] + [gn["y1"] for gn in r["gnames"]] + [max(p[1] for p in lb["corners"]) for lb in r["labels"]])
                g.ok(lowest <= r["note"]["top"] + 1, tag + ": note sits below the chart (chart ends %.0f, note starts %.0f)" % (lowest, r["note"]["top"]))
            if w == 300:
                g.ok(r["note"] is not None and ("14px" in r["note"]["text"]), tag + ": small frame explains the 14px floor")
            if w == 1600:
                g.ok(plan["shown"] >= 50 and plan["hidden"] == 128 - plan["shown"], tag + ": a big frame keeps at least 50 labels and counts the rest (%s of 128)" % plan["shown"])
            ctx.close()
    g.close()


def gate_b(b, base):
    g = Gate("B hover: eased fade, two colours, dimmed rest", 18)
    errs = []
    ctx, pg = new_page(b, base + "/test/page.html?w=900&h=600&fx=worm", 900, 600, errs)
    wait_idle(pg)
    graph = pg.evaluate("() => { const G = NX.app.state.model.graph; return { n: G.nodes.length, byId: Object.fromEntries(G.nodes.map(n => [n.id, [n.out, n.inn]])) }; }")
    pg.evaluate("() => { window.__samples = null; }")
    base_a = pg.evaluate("() => NX.app.state.settings.linkOpacity")
    dim_a = pg.evaluate("() => NX.app.state.settings.dimOpacity")
    node = pg.locator('.nx-node[data-id="AVA"] .nx-dot')
    # frame recorder: alpha of one lit link and one dim link every animation frame
    pg.evaluate("""() => {
      window.__rec = { on: true, t: [], lit: [], dim: [] };
      const loop = ts => { const v = NX.app.state.view; const i = v.inspect();
        window.__rec.t.push(ts); window.__rec.lit.push(i.litAlpha); window.__rec.dim.push(i.dimAlpha);
        if (window.__rec.on) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }""")
    node.hover()
    pg.wait_for_timeout(700)
    rec = pg.evaluate("() => { window.__rec.on = false; return window.__rec; }")
    t = rec["t"]
    lit = [x for x in rec["lit"] if x is not None]
    dim = [x for x in rec["dim"] if x is not None]
    # window of frames during the fade
    gaps = [t[i + 1] - t[i] for i in range(len(t) - 1)]
    g.ok(len(lit) >= 12, "fade spans %d frames (>= 12 at 60 fps over 280 ms)" % len(lit))
    mid = [x for x in lit if 0.03 < x < 0.93]
    g.ok(len(mid) >= 5, "%d intermediate frames between 0 and 0.95, so the fade is eased, not a step" % len(mid))
    g.ok(all(lit[i] <= lit[i + 1] + 1e-9 for i in range(len(lit) - 1)), "lit alpha rises monotonically")
    steps = [lit[i + 1] - lit[i] for i in range(len(lit) - 1)]
    g.ok(max(steps) < 0.35, "biggest single-frame jump in alpha is %.3f (no stepping)" % max(steps))
    # ease in-out: the middle steps are larger than the first and the last
    nz = [s for s in steps if s > 1e-6]
    if len(nz) >= 6:
        g.ok(max(nz[len(nz) // 3: 2 * len(nz) // 3]) > max(nz[0], nz[-1]), "easeInOut: middle steps larger than the ends")
    else:
        g.ok(False, "too few changing frames (%d) to judge the easing" % len(nz))
    g.ok(all(dim[i] >= dim[i + 1] - 1e-9 for i in range(len(dim) - 1)), "dimmed alpha falls monotonically")
    g.ok(abs(lit[-1] - 0.95) < 0.01 and abs(dim[-1] - dim_a) < 0.01, "settled: lit %.3f dim %.3f" % (lit[-1], dim[-1]))
    g.ok(max(gaps) < 70, "slowest animation frame %.1f ms, mean %.1f ms" % (max(gaps), sum(gaps) / len(gaps)))
    g.ok(sum(gaps) / len(gaps) < 22, "mean frame %.1f ms (60 fps is 16.7)" % (sum(gaps) / len(gaps)))
    ins = pg.evaluate("() => NX.app.state.view.inspect()")
    out_n, in_n = graph["byId"]["AVA"]
    g.ok(ins["lit"] == out_n + in_n, "lit links %d equals AVA's degree %d + %d" % (ins["lit"], out_n, in_n))
    cls = pg.evaluate("() => ({ focus: document.querySelectorAll('.nx-node.is-focus').length, out: document.querySelectorAll('.nx-node.is-out').length, inn: document.querySelectorAll('.nx-node.is-in').length, has: document.querySelector('.nx-svg').classList.contains('has-focus') })")
    g.ok(cls["focus"] == 1 and cls["has"], "one focused node, svg flagged has-focus")
    g.ok(cls["out"] == out_n and cls["inn"] == in_n, "%d out-neighbours and %d in-neighbours marked (want %d, %d)" % (cls["out"], cls["inn"], out_n, in_n))
    ro = pg.evaluate("() => { const r = document.querySelector('.nx-readout'); return { hidden: r.hidden, text: r.textContent, fs: parseFloat(getComputedStyle(r).fontSize) }; }")
    g.ok(not ro["hidden"] and "AVA" in ro["text"] and "outgoing" in ro["text"] and "incoming" in ro["text"], "readout names the node and both directions: " + ro["text"])
    g.ok(ro["fs"] >= 14, "readout text %spx" % ro["fs"])
    # the two colours really are different on the canvas: sample the canvas for amber-ish and aqua-ish pixels
    cols = pg.evaluate("""() => {
      const cv = document.querySelector('canvas.nx-canvas'); const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
      const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(cv, 0, 0); const d = x2.getImageData(0, 0, cv.width, cv.height).data;
      let amber = 0, aqua = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue;
        if (d[i] > 200 && d[i + 1] > 150 && d[i + 2] < 120) amber++;
        if (d[i] < 190 && d[i + 1] > 200 && d[i + 2] > 200) aqua++; }
      return { amber, aqua };
    }""")
    g.ok(cols["amber"] > 50 and cols["aqua"] > 50, "canvas shows both lit colours (amber px %d, aqua px %d)" % (cols["amber"], cols["aqua"]))
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "B_hover.png"))
    # release
    pg.mouse.move(2, 2)
    pg.wait_for_timeout(700)
    ins2 = pg.evaluate("() => NX.app.state.view.inspect()")
    g.ok(ins2["focus"] is None and abs(ins2["maxAlpha"] - base_a) < 0.01 and abs(ins2["minAlpha"] - base_a) < 0.01, "released: every link back to %.2f (min %.3f max %.3f)" % (base_a, ins2["minAlpha"], ins2["maxAlpha"]))
    # retarget in mid-fade never jumps
    pg.evaluate("""() => { window.__jump = { vals: [], on: true };
      const loop = () => { window.__jump.vals.push(NX.app.state.view.inspect().layerA); if (window.__jump.on) requestAnimationFrame(loop); };
      requestAnimationFrame(loop); }""")
    node.hover()
    pg.wait_for_timeout(120)
    pg.locator('.nx-node[data-id="RIA"] .nx-dot').hover()
    pg.wait_for_timeout(700)
    jv = [v for v in pg.evaluate("() => { window.__jump.on = false; return window.__jump.vals; }") if v is not None]
    g.ok(len(jv) > 10 and max(abs(jv[i + 1] - jv[i]) for i in range(len(jv) - 1)) < 0.25, "retargeting mid-fade starts from the values on screen (no jump in the dim layer)")
    # focus / keyboard
    pg.mouse.move(2, 2)
    pg.wait_for_timeout(400)
    pg.focus('.nx-node[data-id="AVA"]')
    pg.wait_for_timeout(500)
    g.ok(pg.evaluate("() => NX.app.state.view.inspect().focus") == "AVA", "keyboard focus lights a node as hover does")
    # hover off
    pg.evaluate("() => NX.app.state.settings.hoverHighlight = false")
    g.ok(not errs, "no console errors: " + str(errs[:3]))
    ctx.close()
    g.close()


def gate_c(b, base):
    g = Gate("C selection and hover pushed to Tableau", 12)
    errs = []
    ctx, pg = new_page(b, base + "/test/page.html?w=900&h=600&fx=worm", 900, 600, errs)
    wait_idle(pg)
    pg.locator('.nx-node[data-id="AVA"] .nx-dot').hover()
    pg.wait_for_timeout(200)
    calls = pg.evaluate("() => NX_MOCK.worksheet.calls")
    hov = [c for c in calls if c["call"] == "hoverTuple"]
    g.ok(len(hov) >= 1 and hov[-1]["tuple"] >= 1, "hover pushes a row tuple: %s" % hov[-1:])
    pg.locator('.nx-node[data-id="AVA"] .nx-dot').click()
    pg.wait_for_timeout(300)
    calls = pg.evaluate("() => NX_MOCK.worksheet.calls")
    sel = [c for c in calls if c["call"] == "selectMarksByValue"]
    g.ok(len(sel) == 2, "a click makes two selection calls (Source then Target), got %d" % len(sel))
    if len(sel) == 2:
        g.ok(sel[0]["criteria"] == [{"fieldName": "Source", "value": ["AVA"]}] and sel[0]["mode"] == "select-replace", "first call replaces on Source: %s" % sel[0])
        g.ok(sel[1]["criteria"] == [{"fieldName": "Target", "value": ["AVA"]}] and sel[1]["mode"] == "select-add", "second call adds on Target: %s" % sel[1])
    pg.mouse.move(2, 2)
    pg.wait_for_timeout(700)
    ins = pg.evaluate("() => NX.app.state.view.inspect()")
    g.ok(ins["pinned"] == "AVA" and ins["focus"] == "AVA" and ins["lit"] > 0, "the pinned node stays lit after the pointer leaves")
    g.ok(pg.evaluate("() => document.querySelectorAll('.nx-node.is-pinned').length") == 1, "pinned node is marked")
    hov = [c for c in pg.evaluate("() => NX_MOCK.worksheet.calls") if c["call"] == "hoverTuple"]
    g.ok(hov[-1]["tuple"] == 0, "leaving clears the Tableau hover (tuple 0)")
    pg.locator('.nx-node[data-id="AVA"] .nx-dot').click()
    pg.wait_for_timeout(500)
    ins = pg.evaluate("() => NX.app.state.view.inspect()")
    g.ok(ins["pinned"] is None, "clicking the pinned node again unpins it")
    n_before = len(pg.evaluate("() => NX_MOCK.worksheet.calls"))
    pg.locator('.nx-node[data-id="RIA"] .nx-dot').click()
    pg.wait_for_timeout(200)
    pg.mouse.click(450, 20)   # empty space
    pg.wait_for_timeout(300)
    calls = pg.evaluate("() => NX_MOCK.worksheet.calls")
    g.ok(calls[-1]["call"] == "clearSelectedMarks", "clicking empty space clears the selection in Tableau")
    g.ok(pg.evaluate("() => NX.app.state.view.inspect().pinned") is None, "and unpins")
    # toggles
    pg.evaluate("() => { NX.app.state.settings.clickSelect = false; NX.app.state.settings.pushHover = false; }")
    n0 = len(pg.evaluate("() => NX_MOCK.worksheet.calls"))
    pg.locator('.nx-node[data-id="RMDD"] .nx-dot').click()
    pg.wait_for_timeout(200)
    g.ok(len(pg.evaluate("() => NX_MOCK.worksheet.calls")) == n0, "with click-select and send-hover off, nothing is pushed")
    g.ok(not errs, "no console errors: " + str(errs[:3]))
    ctx.close()
    g.close()


def gate_d(b, base):
    g = Gate("D settings panel", 26)
    errs = []
    ctx, pg = new_page(b, base + "/test/page.html?w=1200&h=760&fx=worm", 1200, 760, errs)
    wait_idle(pg)
    pg.click(".nx-gear")
    pg.wait_for_timeout(500)
    g.ok(pg.evaluate("() => document.querySelector('.nx-panel').classList.contains('open')"), "gear opens the panel")
    g.ok(pg.evaluate("() => document.querySelectorAll('input[type=range]').length") == 0, "no range inputs anywhere")
    nsteppers = pg.evaluate("() => document.querySelectorAll('.nx-stepper').length")
    g.ok(nsteppers >= 8, "%d steppers in the panel" % nsteppers)
    info = pg.evaluate("""() => {
      const p = document.querySelector('.nx-panel'), cs = e => getComputedStyle(e);
      const els = [...p.querySelectorAll('*')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      const bgOf = e => { let x = e; while (x) { const c = cs(x).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; x = x.parentElement; } return 'rgb(255,255,255)'; };
      return { n: els.length, small: els.filter(e => parseFloat(cs(e).fontSize) < 14).map(e => e.className + ':' + cs(e).fontSize).slice(0, 5),
        pairs: els.map(e => [cs(e).color, bgOf(e), e.className, e.textContent.trim().slice(0, 20), e.closest('.nx-seg-btn.on, .nx-btn.danger') ? 1 : 0]) };
    }""")
    g.ok(info["n"] > 20 and not info["small"], "panel: %d text nodes, under 14px: %s" % (info["n"], info["small"]))
    bad = []
    for col, bgc, cls, txt, special in info["pairs"]:
        c = contrast(rgb_of(col), rgb_of(bgc))
        if c < 7 and not special:
            bad.append("%s %r %.2f" % (cls, txt, c))
    g.ok(not bad, "panel text at 7:1 on its own background; under: %s" % bad[:4])
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "D_panel.png"))
    # type into the beta stepper
    path0 = pg.evaluate("() => NX.app.state.view.items[0].path && NX.app.state.view.planned.lay.links[0].d")
    inp = pg.locator('input[aria-label="Bundling strength (beta)"]')
    inp.fill("0.3")
    inp.press("Enter")
    inp.blur()
    pg.wait_for_timeout(800)
    s = pg.evaluate("() => NX_MOCK.settings.getAll()")
    g.ok(s.get("neurons.beta") == "0.3" and isinstance(s["neurons.beta"], str), "typed 0.3 is saved as the string %r" % s.get("neurons.beta"))
    g.ok(pg.evaluate("() => NX_MOCK.settings.saveCount") >= 1, "saveAsync was called")
    path1 = pg.evaluate("() => NX.app.state.view.planned.lay.links[0].d")
    g.ok(path0 != path1 and pg.evaluate("() => NX.app.state.view.planned.lay.beta") == 0.3, "the curve redrew with beta 0.3")
    # plus button steps by the schema step
    pg.locator('input[aria-label="Bundling strength (beta)"]').locator("xpath=..").locator("button").nth(1).click()
    pg.wait_for_timeout(300)
    g.ok(abs(pg.evaluate("() => NX.app.state.settings.beta") - 0.35) < 1e-9, "the + button steps beta by 0.05")
    # out-of-range typed value is clamped
    inp.fill("9")
    inp.press("Enter")
    pg.wait_for_timeout(300)
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 1, "typing 9 clamps to the maximum 1")
    # text size cannot be typed under 14
    fsz = pg.locator('input[aria-label="Text size"]')
    fsz.fill("9")
    fsz.press("Enter")
    pg.wait_for_timeout(400)
    g.ok(pg.evaluate("() => NX.app.state.settings.fontSize") == 14 and pg.evaluate("() => NX.app.state.view.inspect().plan.fs") == 14, "typing 9 for the text size gives 14")
    # chip group and dropdown and toggle
    pg.get_by_role("radio", name="Outgoing", exact=True).click()
    pg.wait_for_timeout(300)
    g.ok(pg.evaluate("() => NX.app.state.settings.hoverMode") == "out", "chip group sets hoverMode")
    pg.select_option('select[aria-label="Order inside a group"]', "degree")
    pg.wait_for_timeout(400)
    g.ok(pg.evaluate("() => NX.app.state.settings.nodeSort") == "degree", "dropdown sets nodeSort")
    pg.locator('.nx-row:has-text("Glow on lit links") .nx-switch').click()
    pg.wait_for_timeout(300)
    g.ok(pg.evaluate("() => NX.app.state.settings.glow") is False, "toggle sets glow false")
    pg.fill('input[aria-label="Outgoing colour hex value"]', "#ff00aa")
    pg.press('input[aria-label="Outgoing colour hex value"]', "Enter")
    pg.locator('input[aria-label="Outgoing colour hex value"]').blur()
    pg.wait_for_timeout(300)
    g.ok(pg.evaluate("() => NX.app.state.settings.outColor") == "#ff00aa", "colour field sets outColor")
    # copy settings gives JSON the Viz pages flow accepts
    pg.get_by_role("button", name="Copy settings").click()
    pg.wait_for_timeout(300)
    try:
        txt = pg.evaluate("() => navigator.clipboard.readText()")
    except Exception as e:
        txt = ""
    obj = {}
    try:
        obj = json.loads(txt)
    except Exception:
        pass
    g.ok(obj.get("beta") == 1 and obj.get("hoverMode") == "out" and obj.get("glow") is False and obj.get("outColor") == "#ff00aa", "Copy settings put valid JSON on the clipboard (%d keys)" % len(obj))
    nkeys = pg.evaluate("() => Object.keys(NX.schema.DEFAULTS).length")
    g.ok(len(obj) == nkeys and nkeys >= 35 and all("." not in k for k in obj), "the block carries all %d settings with dot-free keys (%d in the block)" % (nkeys, len(obj)))
    # paste settings: inline box, no dialog
    pg.get_by_role("button", name="Paste settings").click()
    pg.wait_for_timeout(200)
    ta = pg.locator("textarea.nx-pastearea")
    g.ok(ta.is_visible(), "Paste settings opens an inline box (no browser dialog)")
    ta.fill('{"beta": 0.2, "glow": true, "hoverMode": "both"}')
    pg.get_by_role("button", name="Apply").click()
    pg.wait_for_timeout(500)
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 0.2 and pg.evaluate("() => NX.app.state.settings.glow") is True, "pasted JSON applied")
    ta.fill("{not json")
    pg.get_by_role("button", name="Apply").click()
    pg.wait_for_timeout(200)
    g.ok("not valid" in pg.evaluate("() => document.querySelector('.nx-pastebox').textContent"), "bad JSON is refused inline")
    # reload: settings survive in the mock (Tableau) store
    pg.reload()
    wait_idle(pg, 600)
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 0.2 and pg.evaluate("() => NX.app.state.settings.nodeSort") == "degree", "settings reload from the extension settings store as typed values")
    # reset needs two taps
    pg.click(".nx-gear")
    pg.wait_for_timeout(300)
    pg.get_by_role("button", name="Reset all").click()
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 0.2, "Reset all asks for a second tap")
    pg.get_by_role("button", name="Tap again to confirm").click()
    pg.wait_for_timeout(400)
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 0.85, "second tap resets to the defaults")
    # search and Escape
    pg.fill(".nx-search", "glow")
    pg.wait_for_timeout(200)
    g.ok(pg.evaluate("() => document.querySelectorAll('.nx-row').length") <= 3, "the search box filters settings")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    g.ok(not pg.evaluate("() => document.querySelector('.nx-panel').classList.contains('open')"), "Escape closes the panel")
    g.ok(pg.evaluate("() => window.__audit.dialogs") == 0, "no alert, confirm or prompt was called")
    g.ok(not errs, "no console errors: " + str(errs[:3]))
    ctx.close()
    g.close()


def gate_e(b, base):
    g = Gate("E data shapes and resize", 40)
    cases = {
        "tiny": dict(nodes=9, links=12),
        "ungrouped": dict(nodes=9, links=12),
        "weird": dict(nodes=6, links=None),
        "big": dict(nodes=420, links=None),
        "empty": dict(nodes=0, links=0),
    }
    for fx, want in cases.items():
        errs = []
        t0 = time.time()
        ctx, pg = new_page(b, base + "/test/page.html?w=900&h=600&fx=" + fx, 900, 600, errs)
        pg.wait_for_function("() => window.NX && NX.app.state.ready && NX.app.state.model.graph", timeout=15000)
        pg.wait_for_timeout(1200 if fx != "big" else 2500)
        took = time.time() - t0
        r = pg.evaluate(COLLECT)
        g.ok(not errs, "%s: console errors %s" % (fx, errs[:3]))
        g.ok(r["nodes"] == want["nodes"], "%s: %d nodes (want %d)" % (fx, r["nodes"], want["nodes"]))
        g.ok(not r["hscroll"] and not r["vscroll"], fx + ": no scroll")
        g.ok(all(f >= 14 for f in r["allText"]), fx + ": all text >= 14px")
        if fx == "empty":
            msg = pg.evaluate("() => { const e = document.querySelector('.nx-empty'); return e.hidden ? '' : e.textContent; }")
            g.ok("Source" in msg and "Target" in msg, "empty: guidance message shown: " + msg)
        else:
            g.ok(r["painted"] > 100, fx + ": canvas painted %d" % r["painted"])
        if fx == "tiny":
            g.ok(r["note"] is None and len(r["labels"]) == 9, "tiny: all 9 labels drawn and no note")
            g.ok(r["plan"]["hidden"] == 0, "tiny: nothing hidden")
        if fx == "ungrouped":
            g.ok(len(r["arcs"]) == 1, "ungrouped: one arc for the single (no group) bucket (%d)" % len(r["arcs"]))
        if fx == "weird":
            g.ok(r["plan"]["clipped"] >= 1 and r["note"] and "clipped" in r["note"]["text"], "weird: the very long name is clipped and the note says so")
            labs = {l["id"]: l["text"] for l in r["labels"]}
            g.ok(any(t.endswith("\u2026") for t in labs.values()), "weird: clipped label ends in an ellipsis")
            g.ok(any(l["text"] == "Zo\u00eb" for l in r["labels"]), "weird: unicode name drawn")
            for i in range(len(r["labels"])):
                for j in range(i + 1, len(r["labels"])):
                    g.ok(not sat_overlap(r["labels"][i]["corners"], r["labels"][j]["corners"]), "weird: label overlap")
        if fx == "big":
            g.ok(r["plan"]["hidden"] > 300 and r["note"] and "Showing" in r["note"]["text"], "big: most labels left out and the note says how many (%s shown)" % r["plan"]["shown"])
            g.ok(took < 12, "big: 420 nodes and 3,000 links ready in %.1f s" % took)
            fps = pg.evaluate("""() => new Promise(res => { const v = NX.app.state.view; const t = [];
              v.setHover(v.graph.nodes[5].id);
              const loop = ts => { t.push(ts); if (t.length < 40) requestAnimationFrame(loop); else res(t); };
              requestAnimationFrame(loop); })""")
            gaps = [fps[i + 1] - fps[i] for i in range(len(fps) - 1)]
            g.ok(sum(gaps) / len(gaps) < 40, "big: hover fade mean frame %.1f ms" % (sum(gaps) / len(gaps)))
            for i in range(len(r["labels"])):
                for j in range(i + 1, min(len(r["labels"]), i + 6)):
                    g.ok(not sat_overlap(r["labels"][i]["corners"], r["labels"][j]["corners"]), "big: label overlap")
        if SHOTS:
            pg.screenshot(path=str(SHOTS / ("E_%s.png" % fx)))
        ctx.close()
    # shelves removed
    errs = []
    ctx, pg = new_page(b, base + "/test/page.html?w=900&h=600&fx=worm", 900, 600, errs)
    wait_idle(pg, 600)
    pg.evaluate("() => NX_MOCK.setEncoding('weight', '')")
    pg.wait_for_timeout(600)
    g.ok(pg.evaluate("() => NX.app.state.model.graph.hasWeight") is True, "weight shelf emptied: fallback finds the Synapses column by name")
    pg.evaluate("() => NX_MOCK.setEncoding('group', '')")
    pg.wait_for_timeout(600)
    g.ok(pg.evaluate("() => NX.app.state.model.graph.nodes.length") == 128, "group shelf emptied: still 128 nodes")
    pg.evaluate("() => { NX_MOCK.setEncoding('source', ''); NX_MOCK.setEncoding('target', ''); }")
    pg.wait_for_timeout(600)
    g.ok(pg.evaluate("() => NX.app.state.model.graph.nodes.length") == 128, "source and target emptied: columns found by name")
    pg.evaluate("() => NX_MOCK.setFixture('empty')")
    pg.wait_for_timeout(500)
    g.ok(pg.evaluate("() => !document.querySelector('.nx-empty').hidden"), "data emptied: message returns")
    pg.evaluate("() => NX_MOCK.setFixture('worm')")
    pg.wait_for_timeout(900)
    g.ok(pg.evaluate("() => document.querySelectorAll('circle.nx-dot').length") == 128, "data restored: chart returns")
    g.ok(not errs, "shelf churn: console errors %s" % errs[:3])
    # resize
    for (w, h) in [(1200, 700), (500, 800), (300, 300), (1600, 1000), (700, 420)]:
        pg.evaluate("([w, h]) => { const s = document.getElementById('stage'); s.style.width = w + 'px'; s.style.height = h + 'px'; }", [w, h])
        pg.set_viewport_size({"width": w, "height": h})
        pg.wait_for_timeout(700)
        r = pg.evaluate(COLLECT)
        g.ok(abs(r["plan"]["cx"] - w / 2) < 1 and not r["hscroll"] and not r["vscroll"], "resize %dx%d: centred, no scroll" % (w, h))
        g.ok(all(f >= 14 for f in r["allText"]), "resize %dx%d: text >= 14px" % (w, h))
        for i in range(len(r["labels"])):
            for j in range(i + 1, min(len(r["labels"]), i + 8)):
                g.ok(not sat_overlap(r["labels"][i]["corners"], r["labels"][j]["corners"]), "resize %dx%d: label overlap" % (w, h))
    g.ok(not errs, "resize: console errors %s" % errs[:3])
    # background plate: mid-grey worksheet
    ctx.close()
    ctx2, pg2 = new_page(b, base + "/test/page.html?w=900&h=600&fx=worm&bg=808080", 900, 600, errs)
    wait_idle(pg2, 800)
    r = pg2.evaluate(COLLECT)
    bgc = rgb_of(r["bg"])
    g.ok(all(contrast(rgb_of(l["fill"]), bgc) >= 7 for l in r["labels"]) and len(r["labels"]) > 0, "mid-grey worksheet: labels still 7:1 (plate %s)" % r["bg"])
    ctx2.close()
    g.close()


def gate_f(b, base):
    g = Gate("F Viz pages stand-in drives it", 14)
    if not STANDIN.exists():
        g.ok(False, "stand-in not found at %s" % STANDIN)
        g.close()
        return
    rows = list(csv.DictReader(open(ROOT / "data" / "celegans-connectome.csv", encoding="utf-8")))
    cols = ["Group", "Source", "Target", "Synapses", "TargetGroup"]
    data = {"columns": cols, "numeric": [False, False, False, True, False],
            "rows": [[r["Group"], r["Source"], r["Target"], int(r["Synapses"]), r["TargetGroup"]] for r in rows]}
    errs = []
    ctx = b.new_context(viewport={"width": 1000, "height": 700})
    ctx.route("**/_vz/standin.js", lambda route: route.fulfill(status=200, content_type="application/javascript", body=STANDIN.read_text(encoding="utf-8")))
    ctx.route("**/_vz/data.json", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(data)))
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(base + "/test/standin.html")
    wait_idle(pg, 1200)
    r = pg.evaluate(COLLECT)
    g.ok(not errs, "stand-in: console errors %s" % errs[:3])
    g.ok(r["dots"] == 128 and r["painted"] > 300, "stand-in: 128 nodes drawn, canvas painted %d" % r["painted"])
    g.ok(pg.evaluate("() => NX.app.state.settings.beta") == 0.5 and pg.evaluate("() => NX.app.state.settings.glow") is False, "stand-in: the owner's nested settings JSON (beta, glow) was read through settings.get")
    g.ok(pg.evaluate("() => NX.app.state.model.names.group") == "Group" and pg.evaluate("() => NX.app.state.model.names.weight") == "Synapses", "stand-in: encodings came through getVisualSpecificationAsync")
    g.ok(pg.evaluate("() => NX.app.state.model.srcField") == "Source", "stand-in: Source and Target fields resolved")
    g.ok(all(f >= 14 for f in r["allText"]), "stand-in: text >= 14px")
    bgc = rgb_of(r["bg"])
    g.ok(all(contrast(rgb_of(l["fill"]), bgc) >= 7 for l in r["labels"]) and len(r["labels"]) > 0, "stand-in: labels 7:1 (navy default, the stand-in gives no background)")
    g.ok(pg.evaluate("() => document.querySelectorAll('.ctab-exit').length") == 1, "stand-in: its Exit pill is present when opened alone")
    pg.locator('.nx-node[data-id="AVA"] .nx-dot').hover()
    pg.wait_for_timeout(700)
    ins = pg.evaluate("() => NX.app.state.view.inspect()")
    g.ok(ins["focus"] == "AVA" and ins["lit"] > 20, "stand-in: hover lights links (%s lit)" % ins["lit"])
    pg.locator('.nx-node[data-id="AVA"] .nx-dot').click()
    pg.wait_for_timeout(300)
    g.ok(pg.evaluate("() => NX.app.state.view.inspect().pinned") == "AVA" and not errs, "stand-in: click pins the node and the no-op selection call raises nothing")
    pg.click(".nx-gear")
    pg.wait_for_timeout(300)
    inp = pg.locator('input[aria-label="Bundling strength (beta)"]')
    inp.fill("0.7")
    inp.press("Enter")
    pg.wait_for_timeout(700)
    g.ok(pg.evaluate("() => tableau.extensions.settings.get('neurons.beta')") == "0.7", "stand-in: a panel change is kept in the stand-in's settings for the visit")
    g.ok(pg.evaluate("() => typeof tableau.extensions.settings.getAll === 'function' && typeof tableau.extensions.worksheetContent.worksheet.hoverTupleAsync") == "undefined", "stand-in has no hoverTupleAsync, so the extension skips the hover push (feature-detected)")
    g.ok(pg.evaluate("() => typeof tableau.extensions.worksheetContent.worksheet.selectTuplesAsync") == "undefined", "stand-in has no selectTuplesAsync (the extension uses selectMarksByValueAsync only)")
    if SHOTS:
        pg.screenshot(path=str(SHOTS / "F_standin.png"))
    g.ok(not errs, "stand-in after interaction: console errors %s" % errs[:3])
    ctx.close()
    g.close()


def main():
    srv, base = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()
        only = [a for a in sys.argv[1:] if a.startswith("--only=")]
        sel = only[0].split("=")[1] if only else "ABCDEF"
        for k, fn in (("A", gate_a), ("B", gate_b), ("C", gate_c), ("D", gate_d), ("E", gate_e), ("F", gate_f)):
            if k in sel:
                try:
                    fn(b, base)
                except Exception as e:
                    gt = Gate("%s crashed" % k, 0)
                    gt.fails.append("exception: %r" % e)
                    gt.close()
        b.close()
    srv.shutdown()
    bad = sum(1 for r in results if r.fails)
    tot = sum(r.subjects for r in results)
    print("\n%s: %d gates, %d RED, %d subjects examined" % ("RED" if bad else "GREEN", len(results), bad, tot))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
