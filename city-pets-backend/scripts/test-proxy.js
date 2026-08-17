/* =========================================================
   CITY PETS — Proxy inverso mínimo para la suite (G15, Fase 9.6)
   Simula el comportamiento de nginx (reverse proxy a 127.0.0.1:3000)
   para validar el recorrido: cliente -> proxy -> backend.
   No tiene límite de tamaño de cuerpo: igual que nginx configurado
   con client_max_body_size 26m.
   Uso: PORT=8080 TARGET=3000 node scripts/test-proxy.js
   ========================================================= */

const http = require('http');

const PORT = Number(process.env.PORT || 8080);
const TARGET = Number(process.env.TARGET || 3000);
// Simula la IP del cliente real tal y como la vería nginx. Si se omite,
// se usa la IP del socket (127.0.0.1 en pruebas locales).
const FAKE = process.env.FAKE_CLIENT_IP || '';

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  const clientIp = FAKE || req.socket.remoteAddress;
  headers['x-forwarded-for'] = req.headers['x-forwarded-for']
    ? `${req.headers['x-forwarded-for']}, ${clientIp}`
    : clientIp;
  headers['x-forwarded-proto'] = 'http';
  headers['x-real-ip'] = req.socket.remoteAddress;

  const proxy = http.request({
    host: '127.0.0.1',
    port: TARGET,
    method: req.method,
    path: req.url,
    headers
  }, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  proxy.on('error', (e) => {
    res.statusCode = 502;
    res.end(`proxy error: ${e.message}`);
  });
  req.pipe(proxy);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`test-proxy en 127.0.0.1:${PORT} -> 127.0.0.1:${TARGET}`);
});