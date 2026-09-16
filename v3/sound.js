// 每台裝置獨立記住音效設定；音訊僅在使用者操作後啟用。
const toggle = document.querySelector('#soundToggle');
const volume = document.querySelector('#soundVolume');
let enabled = true;
try { enabled = localStorage.getItem('factor-v3-sound') !== 'off'; volume.value = localStorage.getItem('factor-v3-volume') || '35'; } catch {}
let context;
let master;
function update() {
  toggle.textContent = enabled ? '🔊 音效開' : '🔇 音效關';
  toggle.setAttribute('aria-pressed', String(enabled));
  if (master) master.gain.value = enabled ? Number(volume.value) / 100 : 0;
  try { localStorage.setItem('factor-v3-sound', enabled ? 'on' : 'off'); localStorage.setItem('factor-v3-volume', volume.value); } catch {}
}
async function unlock() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !enabled) return;
    if (!context) { context = new Audio(); master = context.createGain(); master.connect(context.destination); update(); }
    if (context.state === 'suspended') await context.resume();
  } catch { /* 音效不可阻擋測驗。 */ }
}
export function playSound(kind) {
  if (!enabled || context?.state !== 'running') return;
  const notes = { correct: [523, 659, 784], wrong: [220, 165], start: [392, 523, 784] }[kind];
  if (!notes) return;
  try {
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.14;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      oscillator.connect(gain); gain.connect(master);
      oscillator.start(start); oscillator.stop(start + 0.24);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  } catch { /* 不支援音訊時仍可正常答題。 */ }
}
toggle.addEventListener('click', async () => { enabled = !enabled; update(); await unlock(); playSound('correct'); });
volume.addEventListener('input', update);
volume.addEventListener('change', async () => { await unlock(); playSound('correct'); });
document.addEventListener('pointerdown', unlock);
document.addEventListener('keydown', unlock);
update();
