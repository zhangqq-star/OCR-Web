/**
 * 二维码生成模块 — 货架数据压缩 + QR 码绘制 + Logo
 */
const QRUtil = (() => {
  const MAX_DIRECT = 2500;
  const MAX_QR_BYTES = 2953;

  function encodeShelfData(shelf, parts) {
    const data = {
      t: 'sf',
      v: 1,
      s: { n: shelf.name, r: shelf.rowCount || 4 },
      p: parts.map(p => ({
        c: p.code || '',
        n: p.name || '',
        s: p.specs || '',
        q: p.quantity || 1,
        r: p.shelfRow,
        l: p.shelfCol,
        t: p.note || '',
      })),
    };
    const json = JSON.stringify(data);
    const jsonBytes = new TextEncoder().encode(json);
    console.log('[QR] JSON 字节数:', jsonBytes.length);

    // 始终压缩，确保数据量最小
    const compressed = pako.gzip(json);
    const b64 = uint8ToBase64(compressed);
    const payload = 'gz:' + b64;
    const payloadBytes = new TextEncoder().encode(payload).length;
    console.log('[QR] 压缩后字节数:', payloadBytes);

    if (payloadBytes > MAX_QR_BYTES) {
      return { payload: '', compressed: true, size: payloadBytes, error: true };
    }

    return { payload, compressed: true, size: payloadBytes };
  }

  function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async function generate(canvas, text, logoUrl) {
    const textBytes = new TextEncoder().encode(text).length;
    const showLogo = logoUrl && textBytes <= 1500;
    console.log('[QR] bytes:', textBytes, 'showLogo:', showLogo);

    const tmpDiv = document.createElement('div');
    tmpDiv.style.display = 'none';
    document.body.appendChild(tmpDiv);

    try {
      const qr = new QRCode(tmpDiv, {
        text: text,
        width: 280,
        height: 280,
        colorDark: '#1C1C1E',
        colorLight: '#FFFFFF',
        correctLevel: QRCode.CorrectLevel.L,
      });

      await new Promise(r => setTimeout(r, 150));
      const srcCanvas = tmpDiv.querySelector('canvas');
      console.log('[QR] srcCanvas:', !!srcCanvas);

      if (srcCanvas) {
        const ctx = canvas.getContext('2d');
        canvas.width = 280;
        canvas.height = 280;
        ctx.clearRect(0, 0, 280, 280);
        ctx.drawImage(srcCanvas, 0, 0, 280, 280);

        if (showLogo) {
          drawLogo(ctx, 280, logoUrl);
        }
        console.log('[QR] 生成成功');
      } else {
        console.error('[QR] 未找到生成的 canvas');
      }
    } catch (e) {
      console.error('[QR] 生成失败:', e.message);
    }

    document.body.removeChild(tmpDiv);
    return verifyQR(canvas);
  }

  function verifyQR(canvas) {
    return new Promise(resolve => {
      setTimeout(() => {
        try {
          const ctx = canvas.getContext('2d');
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          const ok = !!(code && code.data);
          console.log('[QR] 验证:', ok ? '成功' : '失败');
          resolve(ok);
        } catch (e) {
          console.warn('[QR] 验证出错:', e.message);
          resolve(false);
        }
      }, 100);
    });
  }

  function drawLogo(ctx, canvasSize, logoUrl) {
    const logoSize = Math.floor(canvasSize * 0.2);
    const logoX = (canvasSize - logoSize) / 2;
    const logoY = (canvasSize - logoSize) / 2;
    const padding = 6;
    const radius = 8;

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, logoX - padding, logoY - padding, logoSize + padding * 2, logoSize + padding * 2, radius);
    ctx.fill();
    ctx.restore();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.save();
      roundRect(ctx, logoX, logoY, logoSize, logoSize, radius - 2);
      ctx.clip();
      ctx.drawImage(img, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    };
    img.src = logoUrl;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function download(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename || 'qrcode.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return { encodeShelfData, generate, download };
})();
