const http = require('http');
const data = JSON.stringify({ email: 'nmohod@5riverscap.com', password: 'TempPass2026!' });
const req = http.request({ hostname: 'localhost', port: 8082, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', body.substring(0, 300)));
});
req.write(data);
req.end();
