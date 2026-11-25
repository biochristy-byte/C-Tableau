() => {
  const panel = document.querySelector('.cp-panel');
  const parse = s => { const m = (s || '').match(/[\d.]+/g) || []; return m.map(Number); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const m = parse(getComputedStyle(e).backgroundColor);
    if (m.length >= 3 && (m.length < 4 || m[3] === 1)) return m.slice(0, 3); } return [255, 255, 255]; };
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  panel.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return;
    const tag = el.tagName; let txt = '';
    if (tag === 'INPUT') { if (['checkbox', 'color', 'radio'].includes(el.type)) return; txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: tag + '::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'TEXTAREA') { txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: 'TEXTAREA::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'SELECT') { txt = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''; }
    else { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt += n.textContent.trim() + ' '; }
    if (!txt.trim()) return;
    const cs = getComputedStyle(el);
    out.push({ tag, text: txt.trim().slice(0, 40), size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) });
  });
  return { texts: out, ranges: document.querySelectorAll('input[type=range]').length, tabs: [...panel.querySelectorAll('.cp-tab')].map(t => t.dataset.t) };
}
