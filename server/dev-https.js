// 生成自签名证书 + HTTPS 服务器，用于手机调试
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, 'dev.key');
const certPath = path.join(__dirname, 'dev.crt');

// 用 OpenSSL 生成自签名证书（如果不存在）
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
      { stdio: 'inherit' }
    );
    console.log('[HTTPS] 自签名证书已生成');
  } catch (e) {
    console.error('OpenSSL 不可用，请先安装 OpenSSL 或使用 Git Bash');
    process.exit(1);
  }
}

const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(path.join(__dirname, '..')));

const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app);
server.listen(8443, () => {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  let ip = 'localhost';
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ip = iface.address;
      }
    }
  }
  console.log(`[HTTPS] 服务已启动 → https://${ip}:8443`);
  console.log('[HTTPS] 手机浏览器打开后，忽略证书警告即可');
});
