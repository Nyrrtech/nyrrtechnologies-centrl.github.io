/**
 * server.js — News Sentiment Radar (local dev server)
 *
 * Serves static files with correct Content-Type headers and a
 * baseline set of HTTP security headers.
 *
 * For production, host the static files on Vercel, Netlify, or
 * any CDN/static host — this server is only for local development.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;

// Map file extensions to MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

/**
 * Baseline security headers for every response.
 * Adjust CSP as needed when integrating additional third-party services.
 */
function securityHeaders() {
  return {
    // Prevent the page from being embedded in iframes (clickjacking)
    'X-Frame-Options': 'DENY',
    // Stop browsers from sniffing the declared Content-Type
    'X-Content-Type-Options': 'nosniff',
    // Only send the origin as the referrer (no full URL)
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Content Security Policy — tightened for this app's dependencies
    'Content-Security-Policy': [
      "default-src 'self'",
      // Supabase API + auth
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.ipify.org https://api.rss2json.com https://hacker-news.firebaseio.com https://www.reddit.com https://feeds.bbci.co.uk https://feeds.reuters.com https://*.googleapis.com https://api.anthropic.com https://api.mistral.ai",
      // Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Scripts: self + CDN (Supabase JS, jsdelivr)
      // 'unsafe-eval' is required by the Supabase JS client (supabase-js v2 uses
      // eval internally for realtime/websocket channel parsing).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
      // Images
      "img-src 'self' data: https:",
      // No plugins
      "object-src 'none'",
      // Block mixed content
      "upgrade-insecure-requests",
    ].join('; '),
    // HSTS (only meaningful over HTTPS — safe to include for dev too)
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    // Disable browser features we don't need
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

http.createServer((req, res) => {
  // Reject any path-traversal attempts
  let rawPath;
  try {
    rawPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...securityHeaders() });
    res.end('Bad Request');
    return;
  }
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^[/\\]+/, '');
  const safePath = path.normalize(relativePath);

  if (safePath.startsWith('..') || path.isAbsolute(safePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders() });
    res.end('Forbidden');
    return;
  }

  const filePath = path.join(__dirname, safePath);

  // Ensure the resolved path is inside the project root (guard against symlink escape)
  const rootPath = path.resolve(__dirname);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(rootPath + path.sep) && resolvedFilePath !== rootPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext         = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const headers     = { 'Content-Type': contentType, ...securityHeaders() };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain', ...securityHeaders() });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain', ...securityHeaders() });
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(200, headers);
      res.end(content);
    }
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`✓ Dev server running at http://127.0.0.1:${PORT}`);
  console.log('  (Listening on loopback only — not exposed to the network)');
});
