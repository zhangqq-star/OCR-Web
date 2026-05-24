/**
 * 摄像头模块 — 调用后置摄像头、拍照
 */
const Camera = (() => {
  let stream = null;
  let facingMode = 'environment'; // 默认后置摄像头

  const video = () => document.getElementById('video');
  const canvas = () => document.getElementById('canvas');

  async function start() {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video().srcObject = stream;
      await video().play();
      return true;
    } catch (err) {
      console.error('摄像头启动失败:', err);
      return false;
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    video().srcObject = null;
  }

  function capture() {
    const v = video();
    const c = canvas();
    if (!v.videoWidth) return null;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }

  async function switchCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    return start();
  }

  function isActive() {
    return stream !== null && stream.getTracks().some(t => t.readyState === 'live');
  }

  return { start, stop, capture, switchCamera, isActive };
})();
