// =====================================================================
// ÂM THANH: tổng hợp bằng Web Audio (không cần file âm thanh => nhẹ, offline)
// =====================================================================
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Tiếng "cạch" gỗ: một nhiễu ngắn qua bộ lọc + một âm trầm */
function knock(gainLevel = 0.6, freq = 900) {
  const a = ac(); if (!a) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.06);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2;
  const g = a.createGain(); g.gain.value = gainLevel;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
  const og = a.createGain(); og.gain.setValueAtTime(gainLevel * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(og).connect(a.destination); o.start(t); o.stop(t + 0.12);
}

function beep(freqs, dur = 0.12) {
  const a = ac(); if (!a) return;
  let t = a.currentTime;
  for (const f of freqs) {
    const o = a.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = a.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur);
    t += dur * 0.9;
  }
}

export const Sound = {
  setEnabled(v) { enabled = !!v; },
  move() { if (enabled) knock(0.55, 900); },
  capture() { if (enabled) knock(0.9, 600); },
  check() { if (enabled) { knock(0.7, 800); setTimeout(() => beep([880, 1175]), 60); } },
  end() { if (enabled) beep([523, 659, 784], 0.16); },
  error() { if (enabled) beep([220], 0.15); },
};
