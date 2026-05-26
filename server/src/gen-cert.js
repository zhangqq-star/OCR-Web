/**
 * 生成自签名证书用于移动端 HTTPS 调试
 * 用法: node src/gen-cert.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, '..', 'cert');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('[Cert] 证书已存在 →', certDir);
  console.log('[Cert] 如需重新生成请先删除 cert/ 目录');
  process.exit(0);
}

if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

try {
  const ip = getLocalIP();
  const subj = '/CN=OCRShelf Dev/O=OCRShelf/C=CN';
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "${subj}" -addext "subjectAltName=IP:127.0.0.1,IP:::1,DNS:localhost${ip ? ',IP:' + ip : ''}"`,
    { stdio: 'pipe' }
  );
  console.log('[Cert] 证书已生成 →', certDir);
  if (ip) console.log(`[Cert] 手机访问地址 → https://${ip}:\${PORT}`);
  console.log('[Cert] 手机首次访问需信任证书（见下方说明）');
} catch {
  console.error('[Cert] openssl 未安装，请手动安装 OpenSSL 或使用 mkcert');
  console.error('[Cert] 下载: https://slproweb.com/products/Win32OpenSSL.html');
  process.exit(1);
}

function getLocalIP() {
  try {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return null;
}
