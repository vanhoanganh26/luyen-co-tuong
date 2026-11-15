// =====================================================================
// GIAO DIỆN BÀN CỜ & QUÂN CỜ
// - Danh sách kiểu bàn, chất liệu quân, kiểu chữ (dùng cho hộp Cài đặt)
// - Vân bề mặt bàn (gỗ, giấy, ngọc, cẩm thạch, vải bạt) vẽ bằng bộ lọc SVG,
//   đóng gói thành ảnh SVG (data URL) để trình duyệt chỉ rasterize một lần
// Màu sắc từng kiểu nằm trong css/app.css ([data-board=…], [data-pieces=…])
// =====================================================================

export const BOARD_THEMES = [
  { id: 'go', name: 'Gỗ sáng' },
  { id: 'trac', name: 'Gỗ trắc sẫm' },
  { id: 'giay', name: 'Giấy dó cổ thư' },
  { id: 'ngoc', name: 'Ngọc bích' },
  { id: 'camthach', name: 'Đá cẩm thạch' },
  { id: 'thidau', name: 'Bàn nhựa thi đấu' },
  { id: 'vai', name: 'Vải bạt cờ phố' },
  { id: 'toigian', name: 'Tối giản' },
];

export const PIECE_SETS = [
  { id: 'go', name: 'Gỗ' },
  { id: 'nga', name: 'Ngà trắng' },
  { id: 'ngoc', name: 'Đá ngọc' },
  { id: 'dong', name: 'Đồng cổ' },
  { id: 'phang', name: 'Phẳng hiện đại' },
];

export const PIECE_STYLES = [
  { id: 'han', name: 'Chữ Hán (帥 將 車…)' },
  { id: 'thuphap', name: 'Chữ Hán thư pháp' },
  { id: 'viet', name: 'Chữ Việt (Tướng, Xe…)' },
  { id: 'icon', name: 'Hình biểu tượng' },
];

// ---------- Hình biểu tượng quân cờ (tự vẽ, tâm tại 0,0, khung ~ ±26) ----------
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
export const ICONS = {
  // Tướng: vương miện
  k: 'M-24 10L-27 -15L-12 -3L0 -24L12 -3L27 -15L24 10Z M-24 14H24V22H-24Z' + circ(0, 0, 4),
  // Sĩ: khiên có chữ thập
  a: 'M0 -25L21 -17V1C21 13 11 20 0 26C-11 20 -21 13 -21 1V-17Z M-3 -15H3V-7H11V-1H3V13H-3V-1H-11V-7H-3Z',
  // Tượng: con voi (vòi bên phải)
  b: 'M-24 6C-25 -9 -14 -19 2 -19C15 -19 22 -12 24 -3C26 4 26 12 25 21H19V8C17 11 15 12 13 12V21H7V12H-6V21H-12V12C-17 12 -22 10 -24 6Z' + circ(12, -7, 2.6),
  // Mã: đầu ngựa
  n: 'M-15 23H17C17 10 12 2 14 -6C16 -15 10 -23 0 -23L-4 -27L-7 -21C-15 -17 -21 -7 -23 0L-19 7L-8 2C-4 5 -7 11 -15 23Z' + circ(3, -13, 2.6),
  // Xe: cỗ xe có cờ
  r: 'M-1 -27L13 -23L-1 -19Z M-3 -27H1V-14H-3Z M-24 -14H24L21 6H-21Z' + circ(-12, 13, 9) + circ(-12, 13, 3) + circ(12, 13, 9) + circ(12, 13, 3),
  // Pháo: nòng pháo trên bánh xe
  c: 'M-25 1L16 -19L21 -9L-20 10Z M14 -22L23 -7L19 -5L10 -20Z' + circ(-4, 12, 11) + circ(-4, 12, 4),
  // Tốt: người lính
  p: 'M-15 23H15L11 14L6 2C10 -2 8 -7 0 -7C-8 -7 -10 -2 -6 2L-11 14Z' + circ(0, -15, 8),
};

// ---------- Vân bề mặt ----------
const W = 920, H = 1092; // khớp kích thước bàn trong board-view.js

/** Một lớp nhiễu tô màu: alpha = a·nhiễu + b (cắt theo hình chữ nhật bo góc) */
function noiseLayer(id, { type = 'fractalNoise', fx, fy = fx, oct = 3, seed = 2, color, a, b }) {
  const [R, G, B] = color.match(/\w\w/g).map((h) => (parseInt(h, 16) / 255).toFixed(3));
  return {
    def: `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
      + `<feTurbulence type="${type}" baseFrequency="${fx} ${fy}" numOctaves="${oct}" seed="${seed}"/>`
      + `<feColorMatrix type="matrix" values="0 0 0 0 ${R} 0 0 0 0 ${G} 0 0 0 0 ${B} ${a} 0 0 0 ${b}"/>`
      + `<feComposite in2="SourceGraphic" operator="in"/></filter>`,
    use: `<rect width="${W}" height="${H}" rx="18" fill="#fff" filter="url(#${id})"/>`,
  };
}

const TEXTURES = {
  go: [{ fx: 0.003, fy: 0.07, oct: 4, seed: 7, color: '7a4a1c', a: 0.9, b: -0.36 }],
  trac: [
    { fx: 0.0025, fy: 0.09, oct: 4, seed: 11, color: '1a0904', a: 1.5, b: -0.55 },
    { fx: 0.02, fy: 0.3, oct: 2, seed: 3, color: 'b0623a', a: 0.6, b: -0.3 },
  ],
  giay: [
    { fx: 0.85, oct: 2, seed: 5, color: '6b5530', a: 0.55, b: -0.24 },
    { fx: 0.012, oct: 3, seed: 9, color: '8a6a3a', a: 0.6, b: -0.28 },
  ],
  ngoc: [
    { fx: 0.006, fy: 0.011, oct: 5, seed: 4, color: 'e9fff2', a: 1.3, b: -0.55 },
    { fx: 0.02, oct: 3, seed: 8, color: '0b3527', a: 0.9, b: -0.42 },
  ],
  camthach: [
    { type: 'turbulence', fx: 0.004, fy: 0.009, oct: 5, seed: 6, color: '6e6e7a', a: -3.2, b: 0.75 },
    { fx: 0.01, oct: 3, seed: 12, color: 'b7b2a8', a: 0.8, b: -0.35 },
  ],
  vai: [{ fx: 0.02, oct: 3, seed: 14, color: '5a4a30', a: 0.7, b: -0.3 }],
};

const cache = new Map();
/** Ảnh vân (data URL) cho kiểu bàn; null nếu kiểu bàn phẳng */
export function textureUrl(theme) {
  if (cache.has(theme)) return cache.get(theme);
  const layers = TEXTURES[theme];
  let url = null;
  if (layers) {
    const parts = layers.map((l, i) => noiseLayer(`t${i}`, l));
    let extra = '', extraUse = '';
    if (theme === 'vai') {
      // Sợi vải đan chéo
      extra = '<pattern id="weave" width="8" height="8" patternUnits="userSpaceOnUse">'
        + '<path d="M0 2H8M0 6H8" stroke="#4a3a22" stroke-opacity=".10" stroke-width="1.6"/>'
        + '<path d="M2 0V8M6 0V8" stroke="#fff" stroke-opacity=".10" stroke-width="1.6"/></pattern>';
      extraUse = `<rect width="${W}" height="${H}" rx="18" fill="url(#weave)"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
      + `<defs>${parts.map((p) => p.def).join('')}${extra}</defs>${parts.map((p) => p.use).join('')}${extraUse}</svg>`;
    url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  cache.set(theme, url);
  return url;
}
