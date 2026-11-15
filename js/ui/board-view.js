// =====================================================================
// BÀN CỜ (SVG): vẽ bàn, quân, đánh dấu; xử lý chạm/click và kéo thả
// Không chứa luật — chỉ gọi các hàm được truyền vào:
//   getLegalTargets(fromSq) -> [toSq...]   canPick(sq) -> bool   onMove({from,to})
// =====================================================================
import { colorOf, typeOf, rowOf, colOf, RED } from '../core/xiangqi.js';
import { ICONS, textureUrl } from './board-themes.js';

const NS = 'http://www.w3.org/2000/svg';
const CELL = 100, M = 60, MY = 96;    // kích thước ô, lề ngang, lề dọc (chừa chỗ ghi số cột)
const W = CELL * 8 + M * 2, H = CELL * 9 + MY * 2;
const PR = 44;                          // bán kính quân

export const HAN = {
  K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
  k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
};
export const VIET = { k: 'Tướng', a: 'Sĩ', b: 'Tượng', n: 'Mã', r: 'Xe', c: 'Pháo', p: 'Tốt' };
let uidSeq = 0; // mỗi bàn cờ một tiền tố id riêng (có thể có bàn xem thử trong Cài đặt)

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export class BoardView {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;               // { getLegalTargets, canPick, onMove, onSelect }
    this.flipped = false;
    this.pieceStyle = 'han';        // 'han' | 'thuphap' | 'viet' | 'icon'
    this.boardTheme = 'go';
    this.pieceSet = 'go';
    this.uid = 'xb' + (++uidSeq);
    this.showLegal = true;
    this.board = new Array(90).fill(null);
    this.selected = -1;
    this.targets = [];
    this.last = null;
    this.checkSq = -1;
    this.hint = null;              // { from, to } gợi ý nước đi (chế độ Học mới)
    this.interactive = true;
    this._build();
  }

  // ---------- Tọa độ ----------
  /** Tọa độ màn hình (SVG) của ô sq, có tính lật bàn */
  xy(s) {
    let r = rowOf(s), c = colOf(s);
    if (this.flipped) { r = 9 - r; c = 8 - c; }
    return [M + c * CELL, MY + r * CELL];
  }
  /** Ô gần nhất với điểm (x, y) theo tọa độ SVG; -1 nếu ở ngoài */
  sqAt(x, y) {
    let c = Math.round((x - M) / CELL), r = Math.round((y - MY) / CELL);
    if (c < 0 || c > 8 || r < 0 || r > 9) return -1;
    if (this.flipped) { r = 9 - r; c = 8 - c; }
    return r * 9 + c;
  }
  clientToSvg(ev) {
    const pt = this.svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  // ---------- Dựng bàn ----------
  _build() {
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'xq-board', role: 'img', 'aria-label': 'Bàn cờ tướng', 'data-board': this.boardTheme, 'data-pieces': this.pieceSet });
    this.svg = svg;
    const defs = el('defs', {}, svg);
    // Vân gỗ cho quân cờ
    const g1 = el('radialGradient', { id: this.uid + 'pg', cx: '40%', cy: '35%', r: '70%' }, defs);
    el('stop', { offset: '0%', class: 'pc-g0' }, g1);
    el('stop', { offset: '100%', class: 'pc-g1' }, g1);
    const sh = el('filter', { id: this.uid + 'ps', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feDropShadow', { dx: '0', dy: '4', stdDeviation: '3', 'flood-opacity': '0.35' }, sh);

    el('rect', { x: 0, y: 0, width: W, height: H, rx: 18, class: 'bd-bg' }, svg);
    // Vân bề mặt (gỗ, giấy, ngọc…) — ảnh SVG phủ lên nền màu
    this.texNode = el('image', { x: 0, y: 0, width: W, height: H, class: 'bd-tex', preserveAspectRatio: 'none' }, svg);
    this._applyTexture();
    this.gridLayer = el('g', { class: 'bd-grid' }, svg);
    this.markLayer = el('g', { class: 'bd-marks' }, svg);
    this.pieceLayer = el('g', { class: 'bd-pieces' }, svg);
    this.hintLayer = el('g', { class: 'bd-hints' }, svg);
    this.dragLayer = el('g', { class: 'bd-drag' }, svg);
    this._drawGrid();
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this._bindInput();
  }

  _drawGrid() {
    const g = this.gridLayer;
    g.innerHTML = '';
    const line = (x1, y1, x2, y2, cls = 'bd-line') => el('line', { x1, y1, x2, y2, class: cls }, g);
    el('rect', { x: M - 10, y: MY - 10, width: CELL * 8 + 20, height: CELL * 9 + 20, class: 'bd-frame' }, g);
    for (let r = 0; r < 10; r++) line(M, MY + r * CELL, M + 8 * CELL, MY + r * CELL);
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) line(M + c * CELL, MY, M + c * CELL, MY + 9 * CELL);
      else {
        line(M + c * CELL, MY, M + c * CELL, MY + 4 * CELL);
        line(M + c * CELL, MY + 5 * CELL, M + c * CELL, MY + 9 * CELL);
      }
    }
    // Đường chéo cung
    line(M + 3 * CELL, MY, M + 5 * CELL, MY + 2 * CELL);
    line(M + 5 * CELL, MY, M + 3 * CELL, MY + 2 * CELL);
    line(M + 3 * CELL, MY + 7 * CELL, M + 5 * CELL, MY + 9 * CELL);
    line(M + 5 * CELL, MY + 7 * CELL, M + 3 * CELL, MY + 9 * CELL);
    // Dấu vị trí pháo & tốt
    const marks = [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]];
    for (const [r, c] of marks) this._cross(g, M + c * CELL, MY + r * CELL, c > 0, c < 8);
    // Chữ sông
    const yR = MY + 4.5 * CELL;
    const han = this.pieceStyle !== 'viet';
    const left = han ? '楚 河' : 'SỞ HÀ', right = han ? '漢 界' : 'HÁN GIỚI';
    const t1 = el('text', { x: M + 2 * CELL, y: yR, class: 'bd-river' + (han ? ' han' : '') + (this.pieceStyle === 'thuphap' ? ' tp' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    t1.textContent = left;
    const t2 = el('text', { x: M + 6 * CELL, y: yR, class: 'bd-river' + (han ? ' han' : '') + (this.pieceStyle === 'thuphap' ? ' tp' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    t2.textContent = right;
    // Số cột: dưới là bên đang ở dưới, trên là bên đối diện (1–9 tính từ phải mỗi bên)
    for (let c = 0; c < 9; c++) {
      const x = M + c * CELL;
      const bottomNum = 9 - c, topNum = c + 1;
      const tb = el('text', { x, y: H - 12, class: 'bd-coord', 'text-anchor': 'middle' }, g);
      tb.textContent = bottomNum;
      const tt = el('text', { x, y: 32, class: 'bd-coord', 'text-anchor': 'middle' }, g);
      tt.textContent = topNum;
    }
  }

  _cross(g, x, y, left, right) {
    const d = 8, l = 18;
    const path = (dx, dy) => `M${x + dx * d} ${y + dy * (d + l)} L${x + dx * d} ${y + dy * d} L${x + dx * (d + l)} ${y + dy * d}`;
    const sides = [];
    if (left) sides.push([-1, -1], [-1, 1]);
    if (right) sides.push([1, -1], [1, 1]);
    for (const [dx, dy] of sides) el('path', { d: path(dx, dy), class: 'bd-mark' }, g);
  }

  // ---------- Quân cờ ----------
  _pieceNode(p, x, y) {
    const g = el('g', { class: `pc ${colorOf(p) === RED ? 'pc-red' : 'pc-black'}` });
    g.style.transform = `translate(${x}px, ${y}px)`;
    el('circle', { r: PR, class: 'pc-body', fill: `url(#${this.uid}pg)`, filter: `url(#${this.uid}ps)` }, g);
    el('circle', { r: PR - 7, class: 'pc-ring' }, g);
    if (this.pieceStyle === 'icon') {
      el('path', { d: ICONS[typeOf(p)], class: 'pc-icon', 'fill-rule': 'evenodd' }, g);
      return g;
    }
    const t = el('text', { class: 'pc-text', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
    if (this.pieceStyle === 'han' || this.pieceStyle === 'thuphap') {
      t.textContent = HAN[p];
      t.classList.add('han');
      if (this.pieceStyle === 'thuphap') t.classList.add('tp');
    } else {
      const word = VIET[typeOf(p)];
      t.textContent = word;
      t.classList.add('viet');
      if (word.length >= 5) t.classList.add('long');
    }
    return g;
  }

  // ---------- Vẽ lại ----------
  /**
   * Cập nhật trạng thái hiển thị.
   * state: { board, last:{from,to}|null, checkSq, animate:{from,to}|null }
   */
  render(state) {
    this.board = state.board.slice();
    this.last = state.last || null;
    this.checkSq = state.checkSq ?? -1;
    this.pieceLayer.innerHTML = '';
    this.dragLayer.innerHTML = '';
    this.pieceNodes = new Map();
    let animNode = null, animFrom = null;
    for (let s = 0; s < 90; s++) {
      const p = this.board[s];
      if (!p) continue;
      const [x, y] = this.xy(s);
      const node = this._pieceNode(p, x, y);
      node.dataset.sq = s;
      if (s === this.checkSq) node.classList.add('in-check');
      if (state.animate && state.animate.to === s) {
        animNode = node; animFrom = this.xy(state.animate.from);
        node.style.transform = `translate(${animFrom[0]}px, ${animFrom[1]}px)`;
      }
      this.pieceLayer.appendChild(node);
      this.pieceNodes.set(s, node);
    }
    if (animNode) {
      const [x, y] = this.xy(state.animate.to);
      animNode.classList.add('moving');
      // Hai khung hình để trình duyệt áp dụng vị trí đầu trước khi chuyển động
      requestAnimationFrame(() => requestAnimationFrame(() => {
        animNode.style.transform = `translate(${x}px, ${y}px)`;
      }));
      setTimeout(() => animNode.classList.remove('moving'), 260);
    }
    this._drawMarks();
  }

  _drawMarks() {
    const g = this.markLayer, h = this.hintLayer;
    g.innerHTML = ''; h.innerHTML = '';
    const box = (s, cls) => {
      const [x, y] = this.xy(s);
      el('rect', { x: x - PR - 4, y: y - PR - 4, width: 2 * PR + 8, height: 2 * PR + 8, rx: 10, class: cls }, g);
    };
    if (this.last) { box(this.last.from, 'mk-last-from'); box(this.last.to, 'mk-last-to'); }
    if (this.hint) {
      box(this.hint.from, 'mk-hint');
      if (this.hint.to !== undefined && this.hint.to !== null) { // gợi ý mức 2 chỉ báo quân cần đi
        const [x, y] = this.xy(this.hint.to);
        el('circle', { cx: x, cy: y, r: PR - 6, class: 'mk-hint-to' }, g);
      }
    }
    if (this.selected >= 0) box(this.selected, 'mk-selected');
    if (this.showLegal) {
      for (const t of this.targets) {
        const [x, y] = this.xy(t);
        if (this.board[t]) el('circle', { cx: x, cy: y, r: PR + 2, class: 'mk-capture' }, h);
        else el('circle', { cx: x, cy: y, r: 13, class: 'mk-dot' }, h);
      }
    }
  }

  setFlipped(f) { this.flipped = f; this._drawGrid(); this.render({ board: this.board, last: this.last, checkSq: this.checkSq }); }
  setPieceStyle(s) { this.pieceStyle = s; this._drawGrid(); this.render({ board: this.board, last: this.last, checkSq: this.checkSq }); }
  setBoardTheme(t) { this.boardTheme = t; this.svg.dataset.board = t; this._applyTexture(); }
  setPieceSet(s) { this.pieceSet = s; this.svg.dataset.pieces = s; }
  _applyTexture() {
    const url = textureUrl(this.boardTheme);
    if (url) { this.texNode.setAttribute('href', url); this.texNode.style.display = ''; }
    else { this.texNode.removeAttribute('href'); this.texNode.style.display = 'none'; }
  }
  setShowLegal(v) { this.showLegal = v; this._drawMarks(); }
  setHint(h) { this.hint = h; this._drawMarks(); }
  setInteractive(v) { this.interactive = v; if (!v) this.clearSelection(); }

  select(s) {
    this.selected = s;
    this.targets = s >= 0 ? this.opts.getLegalTargets(s) : [];
    this._drawMarks();
    this.opts.onSelect?.(s);
  }
  clearSelection() { this.select(-1); }

  // ---------- Nhập liệu: chạm/click + kéo thả (Pointer Events) ----------
  _bindInput() {
    const svg = this.svg;
    let drag = null; // { sq, node, startX, startY, moved }

    const down = (ev) => {
      if (!this.interactive || (ev.button !== undefined && ev.button !== 0)) return;
      const pt = this.clientToSvg(ev);
      const s = this.sqAt(pt.x, pt.y);
      if (s < 0) return;
      // Đã chọn quân và bấm vào ô đích hợp lệ => đi luôn
      if (this.selected >= 0 && this.targets.includes(s)) {
        const from = this.selected;
        this.clearSelection();
        this.opts.onMove({ from, to: s });
        return;
      }
      if (this.board[s] && this.opts.canPick(s)) {
        ev.preventDefault();
        const wasSelected = this.selected === s;
        this.select(s);
        const node = this.pieceNodes.get(s);
        drag = { sq: s, node, startX: pt.x, startY: pt.y, moved: false, wasSelected };
        svg.setPointerCapture?.(ev.pointerId);
      } else {
        this.clearSelection();
      }
    };

    const move = (ev) => {
      if (!drag) return;
      const pt = this.clientToSvg(ev);
      if (!drag.moved && Math.hypot(pt.x - drag.startX, pt.y - drag.startY) < 12) return;
      if (!drag.moved) {
        drag.moved = true;
        // Đưa quân lên lớp trên cùng để kéo không bị che
        this.dragLayer.appendChild(drag.node);
        drag.node.classList.add('dragging');
      }
      drag.node.style.transform = `translate(${pt.x}px, ${pt.y}px) scale(1.12)`;
    };

    const up = (ev) => {
      if (!drag) return;
      const d = drag; drag = null;
      svg.releasePointerCapture?.(ev.pointerId);
      if (!d.moved) {
        // Chạm lại vào quân đang chọn => bỏ chọn
        if (d.wasSelected) this.clearSelection();
        return;
      }
      const pt = this.clientToSvg(ev);
      const s = this.sqAt(pt.x, pt.y);
      d.node.classList.remove('dragging');
      if (s >= 0 && this.targets.includes(s)) {
        this.clearSelection();
        this.opts.onMove({ from: d.sq, to: s, dragged: true });
      } else {
        // Thả sai chỗ => trả quân về vị trí cũ, giữ nguyên lựa chọn
        const [x, y] = this.xy(d.sq);
        d.node.style.transform = `translate(${x}px, ${y}px)`;
        this.pieceLayer.appendChild(d.node);
      }
    };

    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
