# 手机HTTPS调试方案

## 问题
手机无法直接访问本地开发服务器，需要HTTPS才能使用摄像头等API。

## 解决方案

### 1. 生成自签名证书
```bash
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```
> Git Bash下需要 `MSYS_NO_PATHCONV=1` 防止路径转换

### 2. 启动HTTPS服务器
```bash
npx http-server -p 8080 -S -C cert.pem -K key.pem --cors
```

### 3. 手机访问
- 电脑和手机在同一WiFi
- 手机浏览器访问 `https://<电脑IP>:8080`
- 自签名证书会提示不安全，点击"继续访问"

### 4. 查看电脑IP
```bash
ipconfig
```
找到局域网IP（通常是 192.168.x.x）
