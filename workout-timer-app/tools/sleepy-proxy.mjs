// A local stand-in for a sleeping Render free-tier server, for testing the app's
// "Waking up the server" handling. It forwards every request to a real backend,
// but after IDLE_SECONDS without traffic it "falls asleep": the next requests are
// held for WAKE_SECONDS (like Render booting the server), and the first
// HOST_ERRORS of them get a bare 502 instead (like Render's proxy before the app is up).
//
//   node tools/sleepy-proxy.mjs                      # forwards to http://localhost:5000
//   TARGET=https://skiptrack-api.onrender.com WAKE_SECONDS=45 HOST_ERRORS=1 node tools/sleepy-proxy.mjs
//
// Then point the app at it (EXPO_PUBLIC_API_URL=http://<this computer's LAN IP>:5050)
// and run it with `npx expo start`. Not used by the app itself.
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT ?? 5050);
const TARGET = new URL(process.env.TARGET ?? 'http://localhost:5000');
const IDLE_SECONDS = Number(process.env.IDLE_SECONDS ?? 20);
const WAKE_SECONDS = Number(process.env.WAKE_SECONDS ?? 40);
const HOST_ERRORS = Number(process.env.HOST_ERRORS ?? 0);

let lastRequestAt = 0;
let awakeAt = 0; // when the current "boot" finishes
let hostErrorsLeft = 0;

const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

http
  .createServer((req, res) => {
    const now = Date.now();
    if (now - lastRequestAt > IDLE_SECONDS * 1000 && now >= awakeAt) {
      awakeAt = now + WAKE_SECONDS * 1000;
      hostErrorsLeft = HOST_ERRORS;
      log(`asleep -> booting for ${WAKE_SECONDS}s`);
    }
    lastRequestAt = now;
    const path = req.url?.split('?')[0];

    if (now < awakeAt && hostErrorsLeft > 0) {
      hostErrorsLeft -= 1;
      log(`${req.method} ${path} -> 502 (host, app not up)`);
      res.writeHead(502, { 'Content-Type': 'text/html' }).end('<html><body>Bad Gateway</body></html>');
      req.resume();
      return;
    }

    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const wait = Math.max(0, awakeAt - Date.now());
      if (wait > 0) log(`${req.method} ${path} held ${Math.round(wait / 1000)}s (booting)`);
      setTimeout(() => {
        const client = TARGET.protocol === 'https:' ? https : http;
        const upstream = client.request(
          {
            protocol: TARGET.protocol,
            hostname: TARGET.hostname,
            port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: TARGET.host },
          },
          upstreamRes => {
            log(`${req.method} ${path} -> ${upstreamRes.statusCode}`);
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
            upstreamRes.pipe(res);
            lastRequestAt = Date.now();
          },
        );
        upstream.on('error', error => {
          log(`${req.method} ${path} -> upstream error ${error.message}`);
          res.writeHead(502, { 'Content-Type': 'text/html' }).end('<html>Bad Gateway</html>');
        });
        upstream.end(Buffer.concat(body));
      }, wait);
    });
  })
  .listen(PORT, '0.0.0.0', () => log(`sleepy proxy on :${PORT} -> ${TARGET.href}`));
