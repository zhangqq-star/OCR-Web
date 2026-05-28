/**
 * 二维码扫描模块 — 复用 Camera 模块截帧 + jsQR 识别 + pako 解压
 */
const QRScanner = (() => {
  let scanning = false;
  let scanTimer = null;
  let scanCanvas = null;
  let scanCtx = null;
  const SCAN_INTERVAL = 150; // 扫描间隔 ms
  const MAX_SCAN_SIZE = 640; // 扫描最大边长

  function decodePayload(raw) {
    if (!raw) return null;
    try {
      let json;
      if (raw.startsWith('gz:')) {
        const b64 = raw.slice(3);
        const compressed = base64ToUint8(b64);
        json = pako.ungzip(compressed, { to: 'string' });
      } else {
        json = raw;
      }
      const data = JSON.parse(json);
      if (data.t === 'sf' && data.s && data.p) return data;
      if (data.t === 'mf' && data.ss) return data;
      return null;
    } catch (e) {
      console.warn('[QRScanner] decode error:', e.message);
      return null;
    }
  }

  function base64ToUint8(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function startScan(onResult) {
    if (scanning) return;
    scanning = true;
    scanCanvas = document.createElement('canvas');
    scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
    scanFrame(onResult);
  }

  function stopScan() {
    scanning = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    scanCanvas = null;
    scanCtx = null;
  }

  let frameCount = 0;

  function scanFrame(onResult) {
    if (!scanning) return;

    const video = document.getElementById('video');

    // 每 30 帧输出一次状态日志，方便诊断
    if (frameCount % 30 === 0) {
      console.log('[Scanner] video state:', {
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        paused: video.paused,
        srcObject: !!video.srcObject,
      });
    }

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      // 限制扫描尺寸，提高识别速度和成功率
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w > MAX_SCAN_SIZE || h > MAX_SCAN_SIZE) {
        const scale = MAX_SCAN_SIZE / Math.max(w, h);
        w = Math.floor(w * scale);
        h = Math.floor(h * scale);
      }

      scanCanvas.width = w;
      scanCanvas.height = h;
      scanCtx.drawImage(video, 0, 0, w, h);

      const imageData = scanCtx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      frameCount++;
      if (frameCount % 10 === 0) {
        console.log('[Scanner] frame:', frameCount, 'size:', w + 'x' + h, 'found:', !!code, code ? 'data:' + code.data.substring(0, 30) : '');
      }

      if (code && code.data) {
        const decoded = decodePayload(code.data);
        if (decoded) {
          scanning = false;
          console.log('[Scanner] 识别成功:', code.data.substring(0, 50));
          onResult(decoded, code.data);
          return;
        } else {
          console.log('[Scanner] 识别到二维码但解码失败:', code.data.substring(0, 30));
        }
      }
    }

    scanTimer = setTimeout(() => scanFrame(onResult), SCAN_INTERVAL);
  }

  function isActive() {
    return scanning;
  }

  return { startScan, stopScan, decodePayload, isActive };
})();
