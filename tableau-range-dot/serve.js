// Range Dot: a tiny file server with no dependencies.
//
// Run it with:   node serve.js
//
// It uses only what Node ships with, so there is no "npm install" step and
// nothing is downloaded. It also avoids the PowerShell execution-policy block
// that stops npx.ps1 and npm.ps1 on a locked-down Windows machine.
//
// To use a different port:  node serve.js 8795
// If you change the port, change the URL in RangeDot.trex to match, then
// remove and re-add the extension in Tableau.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8771;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.csv': 'text/csv; charset=UTF-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.trex': 'application/xml; charset=UTF-8',
};

const server = http.createServer((req, res) => {
  // A malformed address must cost one request, not the server.
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad request'); return; }
  if (rel === '/') rel = '/index.html';

  // Never serve anything outside this folder, and never a dotfile or dot folder.
  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (path.relative(ROOT, full).split(path.sep).some((part) => part.startsWith('.'))) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      // Caching off, so an edit shows up on the next reload.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already in use.');
    console.error('  Close whatever is using it, or run on another port:  node serve.js 8795');
    console.error('  If you change the port, change the URL in RangeDot.trex to match.\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});

// This machine only. Without the address, Node listens on every network
// interface and anyone on the same Wi-Fi could read this folder.
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  Range Dot is being served.');
  console.log('\n      Tableau:  http://localhost:' + PORT + '/index.html');
  console.log('      Preview:  http://localhost:' + PORT + '/index.html?preview=1');
  console.log('\n  Leave this window OPEN while you work in Tableau.');
  console.log('  Press Ctrl+C to stop.\n');
});
