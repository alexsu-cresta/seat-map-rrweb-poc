import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const basePort = Number(process.env.PORT || 8787);
if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65532) throw new Error('Invalid PORT');
const dist = resolve('dist');
const specs = [
  { name: 'Host', page: 'index', files: ['host.js', 'host.js.map', 'host.css'], offset: 0 },
  { name: 'Recorder', page: 'runner', files: ['runner.js', 'runner.js.map'], offset: 1 },
  { name: 'Replay', page: 'player', files: ['player.js', 'player.js.map'], offset: 2 },
  { name: 'Image fixtures', page: null, files: ['cors.png', 'display-only.png'], offset: 3 },
];
const servers = [];

for (const spec of specs) {
  const server = http.createServer(async (req, res) => {
    const requestedHost = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(requestedHost)) { res.writeHead(403).end(); return; }
    const hostname = requestedHost.startsWith('localhost:') ? 'localhost' : '127.0.0.1';
    const hostOrigin = `http://${hostname}:${basePort}`;
    const origins = [0, 1, 2, 3].map(n => `http://${hostname}:${basePort + n}`);
    const url = new URL(req.url || '/', origins[spec.offset]);
    const common = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    };
    const frameSources = spec.offset === 0 ? `${origins[1]} ${origins[2]}` : "'self'";
    const scriptSource = spec.offset === 1 ? origins[1] : "'self'";
    const imageSources = spec.offset === 1 || (spec.offset === 2 && url.searchParams.get('images') === '1') ? `data: ${origins[3]} https://placehold.co` : 'data:';
    const policy = `default-src 'none'; script-src ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src ${imageSources}; font-src 'none'; connect-src 'none'; frame-src ${frameSources}; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors ${spec.offset === 0 ? "'none'" : hostOrigin}`;
    res.setHeader('Content-Security-Policy', policy);
    for (const [key, value] of Object.entries(common)) res.setHeader(key, value);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    try {
      if (spec.offset === 3) {
        const name = url.pathname.slice(1);
        if (!spec.files.includes(name)) { res.writeHead(404).end(); return; }
        const body = await readFile(resolve('public/assets', name));
        if (name === 'cors.png') res.setHeader('Access-Control-Allow-Origin', '*');
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (url.pathname === '/' || url.pathname === `/${spec.page}.html`) {
        let html = await readFile(`${dist}/${spec.page}.html`, 'utf8');
        html = html.replaceAll('__RUNNER_ORIGIN__', origins[1]).replaceAll('__PLAYER_ORIGIN__', origins[2]).replaceAll('__HOST_ORIGIN__', hostOrigin).replaceAll('__ASSET_ORIGIN__', origins[3]);
        // Inline component/player CSS so recording includes immutable styles without external asset fetches.
        if (spec.offset > 0) html = html.replace('<!-- INLINE_CSS -->', `<style>${await readFile(`${dist}/${spec.page}.css`, 'utf8')}</style>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      const filename = url.pathname.slice(1);
      if (!spec.files.includes(filename)) { res.writeHead(404).end('Not found'); return; }
      const body = await readFile(`${dist}/${filename}`);
      const type = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.map') ? 'application/json' : 'text/javascript';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error(spec.name, error.message);
      res.writeHead(500).end('Build the project with npm run build first.');
    }
  });
  servers.push(server);
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(basePort + spec.offset, '127.0.0.1', resolveReady);
  });
  console.log(`${spec.name}: http://127.0.0.1:${basePort + spec.offset}`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const server of servers) server.close();
  setTimeout(() => process.exit(0), 200).unref();
});
