/**
 * OCR 模块 — 图像预处理 + 多角度识别
 */
const OCR = (() => {

  /**
   * 预处理：灰度化 → 高斯模糊 → Sauvola自适应二值化 → 形态学去噪
   * 目标：纯白背景 + 乌黑文字 + 边缘圆润
   */
  function preprocess(imageData) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const src = ctx.getImageData(0, 0, w, h);
        const pixels = src.data;

        // 1. 灰度化：检测主色调，自适应选择通道权重
        let sumR = 0, sumG = 0, sumB = 0;
        const gray = new Uint8Array(w * h);
        for (let i = 0; i < gray.length; i++) {
          const r = pixels[i * 4];
          const g = pixels[i * 4 + 1];
          const b = pixels[i * 4 + 2];
          sumR += r; sumG += g; sumB += b;
        }
        const total = gray.length;
        const avgR = sumR / total, avgG = sumG / total, avgB = sumB / total;

        // 判断背景是否为黄色调 (高R, 高G, 低B)
        const isYellowBg = (avgR > 160 && avgG > 140 && avgB < avgR * 0.75);
        // 判断是否偏红
        const isRedBg = (avgR > avgG * 1.3 && avgR > avgB * 1.3);

        let wr, wg, wb;
        if (isYellowBg) {
          // 黄色背景：压制RG，强调蓝通道
          wr = 0.10; wg = 0.25; wb = 0.65;
        } else if (isRedBg) {
          // 红色背景：压制R，强调绿蓝
          wr = 0.10; wg = 0.45; wb = 0.45;
        } else {
          // 默认：标准 luminance
          wr = 0.299; wg = 0.587; wb = 0.114;
        }

        for (let i = 0; i < gray.length; i++) {
          gray[i] = Math.round(wr * pixels[i*4] + wg * pixels[i*4+1] + wb * pixels[i*4+2]);
        }

        // 2. 高斯模糊 (sigma≈1.0, 核半径2, 可分离卷积) → 平滑噪声，让边缘圆润
        const blurred = gaussianBlur(gray, w, h, 2);

        // 3. Sauvola 自适应阈值
        // T = mean * (1 + k * (stddev / R - 1))
        // k=0.4, R=128 (标准偏差最大值的估计)
        const windowR = Math.max(12, Math.floor(Math.min(w, h) / 25));
        const intGray = buildIntegralImage(blurred, w, h);
        const intSq = buildIntegralSqImage(blurred, w, h);
        const binary = new Uint8Array(w * h);
        const k = 0.4, R = 128.0;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - windowR), y1 = Math.max(0, y - windowR);
            const x2 = Math.min(w - 1, x + windowR), y2 = Math.min(h - 1, y + windowR);
            const area = (x2 - x1 + 1) * (y2 - y1 + 1);
            const sum = getIntegralSum(intGray, w, x1, y1, x2, y2);
            const sumSq = getIntegralSum(intSq, w, x1, y1, x2, y2);
            const mean = sum / area;
            const variance = (sumSq / area) - (mean * mean);
            const stddev = Math.sqrt(Math.max(0, variance));
            const threshold = mean * (1 + k * (stddev / R - 1));
            binary[y * w + x] = blurred[y * w + x] > threshold ? 255 : 0;
          }
        }

        // 4. 形态学去噪：去除孤立噪点，填充小空隙
        const cleaned = medianCleanup(binary, w, h);

        // 5. 确保黑字白底（文字像素=0, 背景=255）
        // 如果大部分是黑像素，说明需要翻转
        let blackCount = 0;
        for (let i = 0; i < cleaned.length; i++) {
          if (cleaned[i] === 0) blackCount++;
        }
        const needsInvert = blackCount > total * 0.55;

        const dst = ctx.createImageData(w, h);
        const out = dst.data;
        for (let i = 0; i < cleaned.length; i++) {
          let val = cleaned[i];
          if (needsInvert) val = 255 - val;
          out[i * 4] = val;
          out[i * 4 + 1] = val;
          out[i * 4 + 2] = val;
          out[i * 4 + 3] = 255;
        }

        ctx.putImageData(dst, 0, 0);
        resolve({
          dataURL: c.toDataURL('image/png'),
          w,
          h,
        });
      };
      img.src = imageData;
    });
  }

  // ---- 图像处理工具函数 ----

  // 积分图（灰度值之和）
  function buildIntegralImage(arr, w, h) {
    const integral = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += arr[y * w + x];
        const above = y > 0 ? integral[(y - 1) * w + x] : 0;
        integral[y * w + x] = above + rowSum;
      }
    }
    return integral;
  }

  // 积分图（灰度值平方之和，用于计算方差）
  function buildIntegralSqImage(arr, w, h) {
    const integral = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const val = arr[y * w + x];
        rowSum += val * val;
        const above = y > 0 ? integral[(y - 1) * w + x] : 0;
        integral[y * w + x] = above + rowSum;
      }
    }
    return integral;
  }

  function getIntegralSum(integral, w, x1, y1, x2, y2) {
    const A = (x1 > 0 && y1 > 0) ? integral[(y1 - 1) * w + (x1 - 1)] : 0;
    const B = y1 > 0 ? integral[(y1 - 1) * w + x2] : 0;
    const C = x1 > 0 ? integral[y2 * w + (x1 - 1)] : 0;
    const D = integral[y2 * w + x2];
    return D - B - C + A;
  }

  // 可分离高斯模糊 (sigma≈1.0, radius=2, kernel size=5)
  function gaussianBlur(arr, w, h, radius) {
    // 1D 高斯核
    const sigma = radius / 1.5;
    const kernel = [];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const val = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(val);
      sum += val;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    // 水平 pass
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = Math.min(w - 1, Math.max(0, x + k));
          s += arr[y * w + sx] * kernel[k + radius];
        }
        tmp[y * w + x] = s;
      }
    }

    // 垂直 pass
    const result = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = Math.min(h - 1, Math.max(0, y + k));
          s += tmp[sy * w + x] * kernel[k + radius];
        }
        result[y * w + x] = Math.round(s);
      }
    }
    return result;
  }

  // 中值风格去噪：孤立像素（周围8格同色比例<3则翻转）
  function medianCleanup(binary, w, h) {
    const result = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const val = binary[idx];
        let sameNeighbors = 0, totalNeighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            totalNeighbors++;
            if (binary[ny * w + nx] === val) sameNeighbors++;
          }
        }
        // 如果周围大多数邻居跟自己不同 → 孤立噪点 → 翻转
        result[idx] = (totalNeighbors > 0 && sameNeighbors < 2) ? (255 - val) : val;
      }
    }
    return result;
  }

  /**
   * 旋转图片指定角度，返回新 dataURL
   */
  function rotateImage(imageData, angle) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const rad = (angle * Math.PI) / 180;
        const w = img.width;
        const h = img.height;
        const nw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
        const nh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, nw, nh);
        ctx.translate(nw / 2, nh / 2);
        ctx.rotate(rad);
        ctx.drawImage(img, -w / 2, -h / 2);
        resolve(c.toDataURL('image/png'));
      };
      img.src = imageData;
    });
  }

  /**
   * 去掉 data:image/...;base64, 前缀
   */
  function toBase64(imageData) {
    return imageData.includes('base64,') ? imageData.split('base64,')[1] : imageData;
  }

  /**
   * 从文本中提取 10 位数字编号（修正常见 OCR 混淆）
   * 如 O → 0, I/l → 1, S → 5, Z → 2, B → 8
   */
  function extractCode(text) {
    // 先搜索原始 10 位数字
    const exact = text.match(/\b\d{10}\b/g);
    if (exact) return [...new Set(exact)];

    // 搜索 10 位含常见 OCR 混淆字符的串
    const fuzzy = text.match(/\b[\dOIlSBZ]{10,}\b/gi);
    if (!fuzzy) return [];

    const fixMap = { O: '0', o: '0', I: '1', l: '1', L: '1', S: '5', s: '5', Z: '2', z: '2', B: '8' };
    return [...new Set(fuzzy.map(s => {
      // 只保留数字 + 常见混淆字母
      const cleaned = s.replace(/[^0-9OoIlLSsZzBb]/g, '');
      if (cleaned.length < 10) return null;
      const fixed = cleaned.split('').map(ch => fixMap[ch] || ch).join('');
      // 截取连续数字段中最可能的 10 位
      const nums = fixed.match(/\d{10,}/);
      return nums ? nums[0].slice(0, 10) : null;
    }).filter(Boolean))];
  }

  /**
   * 纯数字优化识别：白名单只保留数字和常见分隔符
   */
  async function recognizeDigitsOnly(worker, base64) {
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: '0123456789 ',
    });
    const { data } = await worker.recognize(base64);
    // 恢复默认
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      tessedit_char_whitelist: '',
    });
    // 提取所有 10 位数字
    const nums = data.text.match(/\b\d{10}\b/g);
    return nums ? [...new Set(nums)] : [];
  }

  /**
   * 主入口：预处理（自适应二值化）→ 识别
   */
  async function recognize(imageData) {
    const updateProgress = (text) => {
      const el = document.getElementById('ocrProgressText');
      if (el) el.textContent = text;
    };

    console.log('[OCR] 原始图片长度:', imageData.length);

    // 1. 预处理：灰度化 + 自适应二值化（针对黄色背景优化）
    updateProgress('预处理图片...');
    console.log('[OCR] 预处理中...');
    const processed = await preprocess(imageData);
    console.log('[OCR] 预处理完成, 尺寸:', processed.w, 'x', processed.h);

    // 2. 创建 Worker
    updateProgress('加载识别引擎...');
    console.log('[OCR] 创建 Worker...');
    const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
      logger: (m) => {
        console.log('[OCR]', m.status, m.progress);
        if (m.status === 'recognizing text') {
          updateProgress(`识别中... ${Math.round(m.progress * 100)}%`);
        }
      },
    });
    console.log('[OCR] Worker 创建完成');

    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });

    // 3. 先用预处理图识别
    updateProgress('识别中...');
    let rawText = '';
    let confidence = 0;
    let codes = [];
    let mode = '常规模式';

    try {
      console.log('[OCR] 用预处理图识别...');
      const { data } = await worker.recognize(processed.dataURL);
      confidence = data.confidence;
      rawText = data.text || '';
      console.log('[OCR] 预处理图结果. 置信度:', confidence, '文本长度:', rawText.length);
      console.log('[OCR] 原始文本:', JSON.stringify(rawText));

      // 提取 10 位编号
      codes = extractCode(rawText);
      console.log('[OCR] 常规模式提取到编号:', codes);

      if (codes.length > 0) {
        mode = '常规模式（中英文混合识别）';
      }

      // 如果常规模式没找到编号，用数字白名单模式再识别
      if (codes.length === 0) {
        console.log('[OCR] 常规模式未找到编号，启用数字白名单模式...');
        updateProgress('数字模式识别...');

        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: '0123456789',
        });

        const { data: digitData } = await worker.recognize(processed.dataURL);
        console.log('[OCR] 数字模式结果:', JSON.stringify(digitData.text));
        const digitNums = digitData.text.match(/\d{10,}/g);
        if (digitNums) {
          codes = [...new Set(digitNums.map(n => n.slice(0, 10)))];
        }

        // 恢复默认参数
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.AUTO,
          tessedit_char_whitelist: '',
        });

        // 合并：常规文本 + 数字识别结果
        if (rawText.trim() && codes.length > 0) {
          rawText = rawText.trim() + '\n' + codes.join('\n');
          mode = '常规 + 数字白名单（合并结果）';
        } else if (codes.length > 0) {
          rawText = codes.join('\n');
          mode = '数字白名单模式（仅识别 0-9）';
        } else if (rawText.trim()) {
          mode = '常规模式（中英文混合识别）';
        }
      }

      // 如果还是空，用原图重试
      if (!rawText.trim()) {
        console.log('[OCR] 预处理图结果为空，用原图重试...');
        updateProgress('原图重试...');
        const { data: data2 } = await worker.recognize(imageData);
        rawText = data2.text || '';
        confidence = data2.confidence;
        mode = '原图模式（无预处理，中英文混合识别）';
        console.log('[OCR] 原图结果. 置信度:', confidence, '文本长度:', rawText.length);
      }
    } catch (e) {
      console.error('[OCR] 识别失败:', e);
    }

    await worker.terminate();
    updateProgress('识别完成');

    return {
      raw: rawText.trim(),
      confidence,
      mode,
      codes,
      debugImage: processed.dataURL,
    };
  }

  function parseParts(lines, codes) {
    const parts = [];
    let current = null;

    for (const line of lines) {
      const kvMatch = line.match(/^(名称|品名|零件|物料|规格|型号|数量|备注|编号|代码|料号)[：:]\s*(.+)/i);
      if (kvMatch) {
        const key = kvMatch[1];
        const val = kvMatch[2];
        if (key === '名称' || key === '品名' || key === '零件' || key === '物料') {
          if (current) parts.push(current);
          current = { name: val, specs: '', quantity: 1, code: '' };
        } else if (current) {
          if (key === '规格' || key === '型号') current.specs = val;
          else if (key === '数量') current.quantity = parseInt(val) || 1;
          else if (key === '编号' || key === '代码' || key === '料号') current.code = val;
        }
      } else if (current && /^\d{1,4}$/.test(line)) {
        current.quantity = parseInt(line) || current.quantity;
      }
    }
    if (current) parts.push(current);

    // 优先用提取到的 10 位编号构建结果
    if (codes.length > 0) {
      return codes.map(code => ({
        name: code,
        code,
        specs: '',
        quantity: 1,
      }));
    }

    // 没有结构化数据 → 每行一个零件
    if (parts.length === 0) {
      for (const line of lines) {
        if (line.length > 0) {
          parts.push({ name: line, specs: '', quantity: 1, code: '' });
        }
      }
    }

    if (parts.length === 0) {
      parts.push({ name: lines[0] || '未识别', specs: '', quantity: 1, code: '' });
    }

    return parts;
  }

  return { recognize };
})();
