/* Neurons Viz Extension - pure layout maths.
 *
 * No DOM here, so node can prove it. It needs the vendored d3-hierarchy and
 * d3-shape on the global `d3` (the browser page and the node test both load
 * lib/d3/*.min.js first).
 *
 *   buildGraph(rows)            rows -> nodes, deduped links, groups
 *   layout(graph, o)            d3.cluster on a radial tree, bundled link paths
 *   plan(graph, w, h, s, m)     one fit: radius, label set, note, arcs
 *   chooseLabels(...)           which labels survive when they cannot all fit
 *   labelPlacement(angle)       rotation that never reads upside down
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var UNGROUPED = '(no group)';

  function D3 () {
    if (!global.d3 || !global.d3.cluster || !global.d3.lineRadial) throw new Error('d3-hierarchy and d3-shape are not loaded');
    return global.d3;
  }

  function natCmp (a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function clean (v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  /* ---------------------------------------------------------------- graph */

  /* rows: [{ group, source, target, weight, targetGroup }]. One row is one
   * link. A node's group comes from the rows where it is the Source; a node
   * that is only ever a Target takes targetGroup if the data carries it. */
  function buildGraph (rows) {
    var byId = Object.create(null);
    var nodes = [];
    var linkIndex = Object.create(null);
    var links = [];
    var dropped = { empty: 0, self: 0 };
    var hasWeight = false;

    function node (id) {
      var n = byId[id];
      if (!n) {
        n = { id: id, group: null, first: nodes.length, out: 0, inn: 0, outW: 0, inW: 0, rows: [] };
        byId[id] = n;
        nodes.push(n);
      }
      return n;
    }

    rows.forEach(function (r, i) {
      var s = clean(r.source), t = clean(r.target);
      if (!s || !t) { dropped.empty++; return; }
      if (s === t) { dropped.self++; return; }
      var w = 1;
      if (r.weight !== undefined && r.weight !== null && r.weight !== '') {
        var num = Number(r.weight);
        if (isFinite(num)) { hasWeight = true; w = Math.max(0, num); } else { hasWeight = true; w = 0; }
      }
      var a = node(s), b = node(t);
      a.rows.push(i); b.rows.push(i);
      var g = clean(r.group);
      if (g && !a.group) a.group = g;
      var tg = clean(r.targetGroup);
      if (tg && !b.tgroup) b.tgroup = tg;
      var m = linkIndex[s] || (linkIndex[s] = Object.create(null));
      var l = m[t];
      if (!l) {
        l = { s: s, t: t, weight: 0, rows: [] };
        m[t] = l;
        links.push(l);
      }
      l.weight += w;
      l.rows.push(i);
    });

    nodes.forEach(function (n) { if (!n.group) n.group = n.tgroup || UNGROUPED; });
    links.forEach(function (l) {
      var a = byId[l.s], b = byId[l.t];
      a.out++; a.outW += l.weight; b.inn++; b.inW += l.weight;
    });

    return { nodes: nodes, byId: byId, links: links, hasWeight: hasWeight, dropped: dropped };
  }

  /* ---------------------------------------------------------------- order */

  function orderGroups (graph, o) {
    var map = Object.create(null), groups = [];
    graph.nodes.forEach(function (n) {
      var g = map[n.group];
      if (!g) { g = { name: n.group, nodes: [], first: groups.length }; map[n.group] = g; groups.push(g); }
      g.nodes.push(n);
    });
    var gOrder = (o && o.groupOrder) || 'data';
    if (gOrder === 'alpha') groups.sort(function (a, b) { return natCmp(a.name, b.name); });
    else if (gOrder === 'size') groups.sort(function (a, b) { return b.nodes.length - a.nodes.length || natCmp(a.name, b.name); });
    var nSort = (o && o.nodeSort) || 'alpha';
    groups.forEach(function (g) {
      if (nSort === 'alpha') g.nodes.sort(function (a, b) { return natCmp(a.id, b.id); });
      else if (nSort === 'degree') g.nodes.sort(function (a, b) { return (b.outW + b.inW) - (a.outW + a.inW) || natCmp(a.id, b.id); });
      else g.nodes.sort(function (a, b) { return a.first - b.first; });
    });
    return groups;
  }

  /* --------------------------------------------------------------- layout */

  /* d3.cluster on a root -> group -> leaf tree, radial: x is the angle
   * (0 at 12 o'clock, clockwise), y the radius. Leaves sit at R, group hubs
   * at R/2, the root at the centre. Links are the path leaf -> hubs -> leaf,
   * drawn with lineRadial + curveBundle.beta(beta). */
  function layout (graph, o) {
    var d3 = D3();
    var groups = orderGroups(graph, o);
    var tree = {
      name: 'root',
      children: groups.map(function (g) {
        return { name: g.name, children: g.nodes.map(function (n) { return { name: n.id, node: n }; }) };
      })
    };
    var root = d3.hierarchy(tree);
    var gap = groups.length > 1 ? o.gap : 0;
    d3.cluster().size([TAU, o.R]).separation(function (a, b) {
      return a.parent === b.parent ? 1 : 1 + gap;
    })(root);
    var rot = o.rotation || 0;
    root.each(function (n) { n.x += rot; });

    var leaves = root.leaves();
    var leafById = Object.create(null);
    leaves.forEach(function (l) { l.id = l.data.name; leafById[l.id] = l; });

    var N = leaves.length;
    /* cycle length in slots: N - G within-group steps of 1, G group steps of 1+gap */
    var cycle = groups.length > 1 ? (N - groups.length) + groups.length * (1 + gap) : N;
    var unit = TAU / cycle;

    var arcs = [];
    root.children.forEach(function (gn, gi) {
      var ls = gn.leaves();
      var first = ls[0].x, last = ls[ls.length - 1].x;
      arcs.push({ name: gn.data.name, index: gi, a0: first - unit * 0.4, a1: last + unit * 0.4, n: ls.length, mid: gn.x });
    });

    var bundle = d3.curveBundle.beta(o.beta);
    var line = d3.lineRadial().curve(bundle).angle(function (d) { return d.x; }).radius(function (d) { return d.y; });
    var out = [];
    graph.links.forEach(function (l) {
      var a = leafById[l.s], b = leafById[l.t];
      if (!a || !b) return;
      var pathNodes = a.path(b);
      out.push({ link: l, a: a, b: b, nodes: pathNodes, d: line(pathNodes) });
    });
    return { root: root, leaves: leaves, leafById: leafById, groups: groups, arcs: arcs, links: out, unit: unit, R: o.R, beta: o.beta };
  }

  /* Points along a link's drawn curve, for the tests: runs the same
   * lineRadial + curveBundle through a recording context. */
  function curveSamples (pathNodes, beta, per) {
    var d3 = D3();
    var pts = [];
    var cur = null;
    var K = per || 16;
    var rec = {
      moveTo: function (x, y) { cur = [x, y]; pts.push(cur); },
      lineTo: function (x, y) {
        for (var i = 1; i <= K; i++) pts.push([cur[0] + (x - cur[0]) * i / K, cur[1] + (y - cur[1]) * i / K]);
        cur = [x, y];
      },
      bezierCurveTo: function (x1, y1, x2, y2, x, y) {
        for (var i = 1; i <= K; i++) {
          var t = i / K, u = 1 - t;
          pts.push([
            u * u * u * cur[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * cur[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
          ]);
        }
        cur = [x, y];
      },
      closePath: function () {}
    };
    d3.lineRadial().curve(d3.curveBundle.beta(beta)).angle(function (d) { return d.x; }).radius(function (d) { return d.y; }).context(rec)(pathNodes);
    return pts;
  }

  function polar (angle, r) { return [r * Math.sin(angle), -r * Math.cos(angle)]; }

  /* ---------------------------------------------------------------- labels */

  function norm (a) { a = a % TAU; return a < 0 ? a + TAU : a; }
  function angDist (a, b) { var d = Math.abs(norm(a) - norm(b)); return d > Math.PI ? TAU - d : d; }

  /* Rotation for a radial label at `angle`: right half reads outward, left
   * half is turned 180 degrees and anchored at its end. The result is always
   * within [-90, 90) degrees, so text is never upside down. */
  function labelPlacement (angle) {
    var a = norm(angle);
    var deg = a * 180 / Math.PI - 90;
    var flip = a > Math.PI;
    return { rotate: flip ? deg - 180 : deg, flip: flip };
  }

  /* Which labels survive. items: [{ id, angle, priority }]. Labels run
   * radially from radius r0 and are lineH tall, so two neighbours clear each
   * other when the chord between their start points is at least lineH.
   * Greedy by priority; each accepted label is checked against its two
   * angular neighbours in a sorted list. */
  function chooseLabels (items, r0, lineH) {
    var shown = Object.create(null);
    if (!items.length || r0 <= 0 || lineH / (2 * r0) >= 1) return { shown: shown, count: 0 };
    var minD = 2 * Math.asin(lineH / (2 * r0));
    var order = items.slice().sort(function (a, b) { return b.priority - a.priority || natCmp(a.id, b.id); });
    var acc = [];
    var count = 0;
    order.forEach(function (it) {
      var a = norm(it.angle);
      var lo = 0, hi = acc.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (acc[mid] < a) lo = mid + 1; else hi = mid; }
      if (acc.length) {
        var prev = acc[(lo - 1 + acc.length) % acc.length];
        var next = acc[lo % acc.length];
        if (angDist(a, prev) < minD || angDist(a, next) < minD) return;
      }
      acc.splice(lo, 0, a);
      shown[it.id] = true;
      count++;
    });
    return { shown: shown, count: count };
  }

  function priorities (graph, mode) {
    var p = Object.create(null);
    graph.nodes.forEach(function (n) {
      if (mode === 'links') p[n.id] = n.out + n.inn;
      else if (mode === 'alpha') p[n.id] = 0;
      else p[n.id] = n.outW + n.inW;
    });
    return p;
  }

  function fitText (text, maxW, fs, measure) {
    if (measure(text, fs) <= maxW) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (measure(text.slice(0, mid) + '…', fs) <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo) + '…' : text.slice(0, 1);
  }

  /* ------------------------------------------------------------------ plan */

  var ARC_W = 5;
  var ARC_GAP = 6;

  /* One fit of the chart into w x h. Returns every radius the renderer
   * needs plus the label decisions and the note to show. `measure(text, px)`
   * returns a width in px. The font size is never below the schema minimum. */
  function plan (graph, w, h, s, measure) {
    var fs = Math.max(14, Number(s.fontSize) || 14);
    var lineH = Math.round((measure.height ? Math.max(fs * 1.1, measure.height(fs) + 1) : fs * 1.25) * 10) / 10;
    var nodeSize = s.nodeSize;
    var N = graph.nodes.length;
    var groups = orderGroups(graph, s);
    var G = groups.length;
    var prio = priorities(graph, s.labelPriority);

    var widths = Object.create(null), maxW = 0;
    if (s.showLabels) graph.nodes.forEach(function (n) { var m = measure(n.id, fs); widths[n.id] = m; if (m > maxW) maxW = m; });

    var noteH = 0, res = null;
    for (var pass = 0; pass < 2; pass++) {
      var availH = h - noteH;
      var half = Math.max(20, Math.min(w, availH) / 2 - 4);
      var pad = nodeSize + 7;
      var cap = Math.max(fs * 3, half * 0.34);
      var Lw = s.showLabels ? Math.min(cap, maxW) : 0;
      var nameBand = s.showGroupNames ? Math.round(fs * 1.45) + 4 : 0;

      function radiusFor (lw, band) {
        var inner = lw > 0 ? pad + lw : nodeSize + 4;
        return half - inner - ARC_GAP - ARC_W - band;
      }
      var R = radiusFor(Lw, nameBand);
      var labelsOn = Lw > 0;
      if (labelsOn && R < 48) { labelsOn = false; Lw = 0; R = radiusFor(0, nameBand); }

      /* Group names go on the arc's outside edge, as text along the arc. Keep
       * the band only if at least one name fits its arc. */
      var unit0 = 0;
      var nameShown = Object.create(null), anyName = false, namesHidden = 0;
      if (s.showGroupNames) {
        var gap = G > 1 ? s.groupGap : 0;
        var cycle = G > 1 ? (N - G) + G * (1 + gap) : N;
        unit0 = TAU / cycle;
        var arcR0 = R + (labelsOn ? pad + Lw : nodeSize + 4) + ARC_GAP + ARC_W / 2;
        groups.forEach(function (g) {
          var span = (g.nodes.length - 1 + 0.8) * unit0 * (arcR0 + fs * 0.75);
          var ok = measure(g.name, fs) + 12 <= span;
          nameShown[g.name] = ok;
          if (ok) anyName = true; else namesHidden++;
        });
        if (!anyName) {
          nameBand = 0;
          R = radiusFor(Lw, 0);
          if (labelsOn && R < 48) { labelsOn = false; Lw = 0; R = radiusFor(0, 0); }
        }
      }
      R = Math.max(R, 16);

      /* Label slots: leaf angles come from the same cluster maths, so
       * compute them with a throwaway layout at this radius. */
      var lay = layout(graph, { R: R, beta: s.beta, gap: s.groupGap, rotation: (s.rotation || 0) * Math.PI / 180, groupOrder: s.groupOrder, nodeSort: s.nodeSort });
      var r0 = R + pad;
      var chosen = { shown: Object.create(null), count: 0 };
      if (labelsOn) {
        chosen = chooseLabels(lay.leaves.map(function (l) { return { id: l.id, angle: l.x, priority: prio[l.id] }; }), r0, lineH);
      }
      var labelText = Object.create(null), clipped = 0;
      if (labelsOn) {
        Object.keys(chosen.shown).forEach(function (id) {
          var t = fitText(id, Lw, fs, measure);
          if (t !== id) clipped++;
          labelText[id] = t;
        });
      }
      var hidden = labelsOn ? N - chosen.count : (s.showLabels ? N : 0);
      var parts = [];
      if (s.showLabels && hidden > 0) {
        if (!labelsOn) parts.push('Labels are off at this size (' + fs + 'px text would not fit); hover a node for its name.');
        else parts.push('Showing ' + chosen.count + ' of ' + N + ' labels at ' + fs + 'px; hover a node for the rest.');
      }
      if (labelsOn && clipped > 0) parts.push(clipped + ' long ' + (clipped === 1 ? 'name is' : 'names are') + ' clipped; hover for the full name.');
      if (s.showGroupNames && namesHidden > 0) parts.push(namesHidden + ' group ' + (namesHidden === 1 ? 'name is' : 'names are') + ' left off a short arc.');
      var note = parts.length ? parts.join(' ') : null;

      res = {
        w: w, h: h, fs: fs, lineH: lineH, half: half, R: R, pad: pad, r0: r0, Lw: Lw, labelsOn: labelsOn,
        shown: chosen.shown, shownCount: chosen.count, labelText: labelText, hidden: hidden, clipped: clipped,
        arcR: R + (labelsOn ? pad + Lw : nodeSize + 4) + ARC_GAP + ARC_W / 2, arcW: ARC_W,
        nameBand: nameBand, nameShown: nameShown, namesHidden: namesHidden, note: note, noteH: noteH,
        cx: w / 2, cy: (h - noteH) / 2, lay: lay
      };
      if (pass === 0) {
        if (!note) break;
        var lines = Math.max(1, Math.ceil(measure(note, fs) / Math.max(60, w - 24)));
        noteH = Math.ceil(lines * fs * 1.35 + 10);
      }
    }
    return res;
  }

  global.NX = global.NX || {};
  global.NX.layout = {
    TAU: TAU, UNGROUPED: UNGROUPED, buildGraph: buildGraph, orderGroups: orderGroups, layout: layout,
    curveSamples: curveSamples, polar: polar, chooseLabels: chooseLabels, labelPlacement: labelPlacement,
    plan: plan, fitText: fitText, natCmp: natCmp, angDist: angDist, norm: norm
  };
})(typeof window !== 'undefined' ? window : globalThis);
