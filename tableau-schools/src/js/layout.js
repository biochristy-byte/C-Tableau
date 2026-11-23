/* Schools - layout math. Pure functions, no DOM, so node can test them.
 * Needs d3-force and d3-hierarchy (packSiblings) from lib/ as global d3.
 *
 *   layoutSchools  items -> circles clustered by category, settled OFF-SCREEN with d3-force ticks,
 *                  then a pairwise relaxation that guarantees no overlaps, then one uniform scale
 *                  to fit the stage. Runs the job below to completion in one call.
 *   layoutJob      the same work as a resumable job: step(budgetMs) does units of work until the
 *                  budget is spent and returns true when done (result in .result). The renderer
 *                  runs it a few ms per animation frame, so no frame ever carries the whole layout.
 *                  step(Infinity) is layoutSchools; the output is identical however it is sliced.
 *   planChips      label chips that never overlap each other
 *   ease / lerp    eased motion between two settled layouts
 */
(function (global) {
  'use strict';
  var d3 = global.d3;

  function maxOverlap(nodes) {
    var worst = -Infinity;
    for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
      var a = nodes[i], b = nodes[j], o = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
      if (o > worst) worst = o;
    }
    return worst;
  }

  /* One relaxation pass: push overlapping pairs apart. The grid is built once at the start of the pass,
   * then rows are visited in order; `st` holds where the pass stopped, so it can resume in a later frame
   * with exactly the same result. Returns true when the pass is complete (st.moved says if anything moved). */
  function relaxRows(nodes, gap, cell, st, deadline, now) {
      if (!st.grid) {
        var grid = new Map(); st.grid = grid; st.i = 0; st.moved = false;
        nodes.forEach(function (n, i) {
          var key = Math.floor(n.x / cell) + ',' + Math.floor(n.y / cell);
          var b = grid.get(key); if (b) b.push(i); else grid.set(key, [i]);
        });
      }
      grid = st.grid;
      var moved = false;
      for (var i = st.i; i < nodes.length; i++) {
        if (((i - st.i) & 15) === 15 && now() >= deadline) { st.i = i; st.moved = st.moved || moved; return false; }
        var a = nodes[i], gx = Math.floor(a.x / cell), gy = Math.floor(a.y / cell);
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          var b = grid.get((gx + dx) + ',' + (gy + dy)); if (!b) continue;
          for (var q = 0; q < b.length; q++) {
            var j = b[q]; if (j <= i) continue;
            var c = nodes[j], ddx = c.x - a.x, ddy = c.y - a.y, d = Math.hypot(ddx, ddy), need = a.r + c.r + gap;
            if (d >= need) continue;
            if (d < 1e-9) { ddx = Math.cos(i * 2.399); ddy = Math.sin(i * 2.399); d = 1; }
            var push = (need - d) / 2 + 1e-6, ux = ddx / d, uy = ddy / d;
            a.x -= ux * push; a.y -= uy * push; c.x += ux * push; c.y += uy * push; moved = true;
          }
        }
      }
      st.moved = st.moved || moved; st.grid = null;
      return true;
  }
  function relaxPass(nodes, gap, cell) { var st = {}; relaxRows(nodes, gap, cell, st, Infinity, function () { return 0; }); return st.moved; }
  function relaxCell(nodes, gap) { var rmax = 0; nodes.forEach(function (n) { if (n.r > rmax) rmax = n.r; }); return Math.max(4, 2 * rmax + gap); }
  /* Push overlapping pairs apart until none overlap (by at least `gap`). Grid-bucketed, deterministic. */
  function relax(nodes, gap, maxPasses) {
    var cell = relaxCell(nodes, gap), passes = 0;
    for (; passes < maxPasses; passes++) if (!relaxPass(nodes, gap, cell)) break;
    return passes;
  }

  /* items: [{ id, name, cluster, value, color, tuple }]
   * o: { w, h, pad, minR, areaFill (0..1), spread, pull (1..10), margin, topBand, ticks } */
  function layoutSchools(items, o) { var job = layoutJob(items, o); job.step(Infinity); return job.result; }

  function layoutJob(items, o) {
    var n = items.length;
    if (!n) return { result: { nodes: [], clusters: [], scale: 1, maxOverlap: 0, ticks: 0, passes: 0 }, step: function () { return true; } };
    var W = Math.max(40, o.w - 2 * o.margin), H = Math.max(40, o.h - 2 * o.margin - o.topBand);
    var sumV = 0; items.forEach(function (it) { sumV += it.value; });
    var k = Math.sqrt(W * H * o.areaFill / (Math.PI * sumV));
    var nodes = items.map(function (it) {
      return { id: it.id, name: it.name, cluster: it.cluster, value: it.value, color: it.color, tuple: it.tuple, r: Math.max(o.minR, k * Math.sqrt(it.value)), x: 0, y: 0 };
    });
    // clusters, largest first
    var byC = new Map();
    nodes.forEach(function (nd) { var c = byC.get(nd.cluster); if (!c) { c = { name: nd.cluster, nodes: [], total: 0 }; byC.set(nd.cluster, c); } c.nodes.push(nd); c.total += nd.value; });
    var clusters = Array.from(byC.values()).sort(function (a, b) { return b.total - a.total || (a.name < b.name ? -1 : 1); });
    clusters.forEach(function (c, i) {
      c.idx = i; c.nodes.sort(function (a, b) { return b.value - a.value || (a.id < b.id ? -1 : 1); });
      var area = 0; c.nodes.forEach(function (nd) { area += Math.PI * (nd.r + o.pad / 2) * (nd.r + o.pad / 2); nd.cl = c; });
      c.R = Math.sqrt(area / (Math.PI * 0.6));
    });
    var packed = d3.packSiblings(clusters.map(function (c) { return { r: c.R + o.spread / 2 }; }));
    // stretch the cluster centres toward the stage's aspect ratio, so a wide stage is filled sideways instead of leaving empty sides.
    // Stretching only increases the distance between centres, so it can never push two clusters into each other.
    var px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
    packed.forEach(function (q, i) { var r = clusters[i].R + o.spread / 2; px0 = Math.min(px0, q.x - r); px1 = Math.max(px1, q.x + r); py0 = Math.min(py0, q.y - r); py1 = Math.max(py1, q.y + r); });
    var asp = (W / H) / Math.max(1e-6, (px1 - px0) / Math.max(1e-6, py1 - py0)), sx = 1, sy = 1;
    if (clusters.length > 1) { if (asp > 1) sx = Math.min(Math.pow(asp, 0.55), 2); else sy = Math.min(Math.pow(1 / asp, 0.55), 2); }
    var pcx = (px0 + px1) / 2, pcy = (py0 + py1) / 2;
    clusters.forEach(function (c, i) {
      c.cx = pcx + (packed[i].x - pcx) * sx; c.cy = pcy + (packed[i].y - pcy) * sy;
      c.nodes.forEach(function (nd, j) {
        var a = j * 2.399963, d = c.R * 0.9 * Math.sqrt((j + 0.5) / c.nodes.length);
        nd.x = c.cx + Math.cos(a) * d; nd.y = c.cy + Math.sin(a) * d;
      });
    });
    // force simulation, ticked synchronously. Nothing is drawn until it has settled.
    var maxTicks = o.ticks || (n > 1500 ? 160 : 300);
    var sim = d3.forceSimulation(nodes).stop()
      .alphaDecay(1 - Math.pow(0.001, 1 / maxTicks))
      .force('x', d3.forceX(function (d) { return d.cl.cx; }).strength(0.02 * o.pull))
      .force('y', d3.forceY(function (d) { return d.cl.cy; }).strength(0.02 * o.pull))
      .force('collide', d3.forceCollide(function (d) { return d.r + o.pad / 2; }).iterations(n > 1500 ? 3 : 1));
    var ticks = 0, phase = 0, oi = 0, worst = -Infinity, overlapAfterSim, passes = 0, cell, rst = {}, job = { result: null };
    // exact max pairwise overlap, resumable by row; returns true when the last row is done
    function overlapRows(deadline, now) {
      for (; oi < n; oi++) {
        var a = nodes[oi];
        for (var j = oi + 1; j < n; j++) { var b = nodes[j], ov = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y); if (ov > worst) worst = ov; }
        if ((oi & 15) === 15 && now() >= deadline) { oi++; return oi >= n; }
      }
      return true;
    }
    job.step = function (budget) {
      var now = budget === Infinity ? function () { return 0; } : (typeof performance !== 'undefined' ? function () { return performance.now(); } : Date.now);
      var deadline = budget === Infinity ? Infinity : now() + budget;
      var u0 = now(), unit = 0;
      while (phase < 4) {
        if (phase === 0) {                       // force ticks
          if (sim.alpha() > sim.alphaMin() && ticks < maxTicks) { sim.tick(); ticks++; }
          else { phase = 1; oi = 0; worst = -Infinity; }
        } else if (phase === 1) {                // overlap after the simulation (reported, not acted on)
          if (overlapRows(deadline, now)) { overlapAfterSim = n > 1 ? worst : -Infinity; phase = 2; cell = relaxCell(nodes, o.pad / 2); }
        } else if (phase === 2) {                // relaxation passes until nothing overlaps (each pass resumable by row)
          if (passes < 400) {
            if (relaxRows(nodes, o.pad / 2, cell, rst, deadline, now)) { if (rst.moved) passes++; else { fit(); phase = 3; oi = 0; worst = -Infinity; } }
          } else { fit(); phase = 3; oi = 0; worst = -Infinity; }
        } else if (phase === 3) {                // final overlap measure
          if (overlapRows(deadline, now)) {
            phase = 4;
            job.result = { nodes: nodes, clusters: clusters, scale: scale, maxOverlap: n > 1 ? worst : -Infinity, overlapAfterSim: overlapAfterSim, ticks: ticks, passes: passes };
            return true;
          }
        }
        // stop when the next unit (about as long as the last one) would cross the deadline, so a slice never overshoots by a whole tick
        var u1 = now(); unit = u1 - u0; u0 = u1;
        if (u1 + unit >= deadline) return false;
      }
      return true;
    };
    var scale = 1;
    // fit: one uniform scale, so settled gaps and the no-overlap guarantee survive it
    function fit() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(function (nd) { x0 = Math.min(x0, nd.x - nd.r); y0 = Math.min(y0, nd.y - nd.r); x1 = Math.max(x1, nd.x + nd.r); y1 = Math.max(y1, nd.y + nd.r); });
    var bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    var s = Math.min(W / bw, H / bh);
    var ox = o.w / 2 - (x0 + bw / 2) * s, oy = o.margin + o.topBand + H / 2 - (y0 + bh / 2) * s;
    nodes.forEach(function (nd) { nd.x = nd.x * s + ox; nd.y = nd.y * s + oy; nd.r *= s; });
    clusters.forEach(function (c) {
      var A = 0, sx = 0, sy = 0;
      c.nodes.forEach(function (nd) { var a = nd.r * nd.r; A += a; sx += nd.x * a; sy += nd.y * a; });
      c.cx = sx / A; c.cy = sy / A; c.R = 0;
      c.nodes.forEach(function (nd) { c.R = Math.max(c.R, Math.hypot(nd.x - c.cx, nd.y - c.cy) + nd.r); });
    });
    scale = s;
    }
    return job;
  }

  /* ---- chips ----
   * cands: [{ id, mode: 'inside' | 'free', x, y, r, texts, prio, spots }]
   *   inside: the chip is centred in the circle (x, y, r) and must fit wholly inside it.
   *   free:   the chip is centred on one of `spots` ([x, y] pairs, tried in order) and must keep off every circle in `avoid`;
   *           `fallback` spots are tried last and may cover circles.
   * `fixed` are rects (x, y, w, h) already on screen that new chips must also avoid.
   * Returns placed chips { id, x, y, w, h, text } (top-left corner). No two chips touch. */
  function planChips(cands, bounds, measure, fontPx, padX, padY, avoid, fixed) {
    var h = Math.round(fontPx + padY * 2), placed = [], all = (fixed || []).slice();
    var order = cands.slice().sort(function (a, b) { return (a.prio - b.prio) || ((b.r || 0) - (a.r || 0)); });
    function hit(l, t, w, hh) {
      for (var i = 0; i < all.length; i++) { var p = all[i]; if (l < p.x + p.w + 3 && l + w + 3 > p.x && t < p.y + p.h + 3 && t + hh + 3 > p.y) return true; }
      return false;
    }
    function inCircle(cx, cy, r, l, t, w, hh) {
      var rr = r - 2, xs = [l, l + w], ys = [t, t + hh];
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) { var dx = xs[i] - cx, dy = ys[j] - cy; if (dx * dx + dy * dy > rr * rr) return false; }
      return true;
    }
    function touchesCircle(l, t, w, hh) {
      for (var i = 0; i < avoid.length; i++) {
        var c = avoid[i], nx = Math.max(l, Math.min(c.x, l + w)), ny = Math.max(t, Math.min(c.y, t + hh));
        if (Math.hypot(nx - c.x, ny - c.y) < c.r + 1) return true;
      }
      return false;
    }
    order.forEach(function (c) {
      var variants = c.texts;
      for (var vi = 0; vi < variants.length; vi++) {
        var text = variants[vi], tw = Math.ceil(measure(text)) + padX * 2;
        var free = c.mode === 'inside' ? [] : (typeof c.spots === 'function' ? c.spots(tw, h) : c.spots);
        var fb = c.mode === 'inside' ? [] : (typeof c.fallback === 'function' ? c.fallback(tw, h) : (c.fallback || []));
        var spots = c.mode === 'inside' ? [[c.x, c.y]] : free.concat(fb);
        var nFree = free.length;
        for (var s = 0; s < spots.length; s++) {
          var left = spots[s][0] - tw / 2, top = spots[s][1] - h / 2;
          if (left < bounds.x0 || left + tw > bounds.x1 || top < bounds.y0 || top + h > bounds.y1) continue;
          if (c.mode === 'inside' && !inCircle(c.x, c.y, c.r, left, top, tw, h)) continue;
          if (c.mode === 'free' && s < nFree && avoid && touchesCircle(left, top, tw, h)) continue;
          if (hit(left, top, tw, h)) continue;
          var chip = { id: c.id, x: left, y: top, w: tw, h: h, text: text };
          placed.push(chip); all.push(chip);
          return;
        }
      }
    });
    return placed;
  }

  /* Places to try a cluster chip: outside the cluster first (above, below, diagonals, sides, a second row),
   * then inside it. Positions depend on the chip size, so these are functions of (width, height). */
  function clusterSpots(c) {
    return {
      spots: function (tw, h) {
        var d = c.R + h / 2 + 4, dx = c.R + tw / 2 + 4, k = c.R * 0.7, o = [];
        o.push([c.cx, c.cy - d], [c.cx, c.cy + d]);
        [-1, 1].forEach(function (sx) { o.push([c.cx + sx * (k * 0.6 + tw * 0.25), c.cy - (k + h / 2 + 4)], [c.cx + sx * (k * 0.6 + tw * 0.25), c.cy + (k + h / 2 + 4)]); });
        [-1, 1].forEach(function (sx) { o.push([c.cx + sx * dx, c.cy]); });
        o.push([c.cx, c.cy - d - h - 3], [c.cx, c.cy + d + h + 3]);
        return o;
      },
      fallback: function (tw, h) {
        var o = [[c.cx, c.cy - c.R * 0.35], [c.cx, c.cy], [c.cx, c.cy + c.R * 0.35]];
        [-1, 1].forEach(function (sx) { o.push([c.cx + sx * c.R * 0.45, c.cy - c.R * 0.45], [c.cx + sx * c.R * 0.45, c.cy + c.R * 0.45]); });
        o.push([c.cx, c.cy - c.R * 0.7], [c.cx, c.cy + c.R * 0.7]);
        return o;
      }
    };
  }

  function ease(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  global.SC = global.SC || {};
  global.SC.layout = { layoutSchools: layoutSchools, layoutJob: layoutJob, planChips: planChips, clusterSpots: clusterSpots, maxOverlap: maxOverlap, relax: relax, ease: ease };
})(typeof window !== 'undefined' ? window : globalThis);
