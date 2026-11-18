// Cuộn KHUNG DANH SÁCH (không cuộn cả trang) để thấy phần tử `el`.
// Thay cho el.scrollIntoView(): trên điện thoại scrollIntoView cuộn cả trang làm bàn cờ bị đẩy khuất.
export function revealInList(el) {
  if (!el) return;
  const box = el.closest('.moves');
  if (!box || box.scrollHeight <= box.clientHeight) return;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 4;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
}
