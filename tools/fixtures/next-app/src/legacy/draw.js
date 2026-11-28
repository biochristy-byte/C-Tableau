// plain legacy script: draws what it is handed as a table with data attributes
window.LL = {
  start: function (root, lines, regions, sample) {
    var h = '<table id="regions"><tbody>';
    regions.forEach(function (r) {
      h += '<tr data-region="' + r.region + '" data-sales="' + r.sales + '" data-disc="' + r.discount + '" data-qty="' + r.quantity + '"><td>' + r.region + '</td></tr>';
    });
    h += '</tbody></table><table id="lines"><tbody>';
    var sums = {}, n = {};
    lines.forEach(function (r) { sums[r.region] = (sums[r.region] || 0) + r.sales; n[r.region] = (n[r.region] || 0) + 1; });
    Object.keys(sums).forEach(function (k) { h += '<tr data-lregion="' + k + '" data-lsales="' + sums[k] + '" data-lcount="' + n[k] + '"><td>' + k + '</td></tr>'; });
    h += '</tbody></table><p id="sample" data-count="' + sample.length + '" data-first-date="' + (lines[0] ? lines[0].orderDate : '') + '"></p>';
    root.innerHTML = h;
    document.body.setAttribute('data-drawn', '1');
  }
};
