// =====================================================================
// BÀI HỌC TƯ DUY — nội dung do Claude soạn (nguyên tắc chung của cờ tướng).
// Ví dụ minh họa KHÔNG tự nghĩ ra: lấy đúng thế cờ trong các biến lý thuyết đã kiểm định
//   { line: id biến, ply: nước thứ mấy (1 = nước đầu) } -> hiện thế TRƯỚC nước đó + giải thích nước đó
//   { line, ply: 'end', factor: 'king' } -> hiện thế cuối biến + chấm yếu tố đó
// =====================================================================
export const LESSONS = [
  {
    id: 'muc-tieu-khai-cuoc', title: '1. Năm mục tiêu của khai cuộc',
    body: [
      'Gần như mọi nước khai cuộc đều phục vụ ít nhất một trong năm mục tiêu: <b>ra quân</b>, <b>tranh trung lộ</b>, <b>an toàn tướng</b>, <b>giành tiên thủ</b> (đi nước có đe dọa để đối phương phải đáp), <b>phối hợp quân</b> (mở đường cho quân khác).',
      'Khi học một biến, đừng chỉ nhớ "nước sau là gì" — hãy gọi tên được mục tiêu của từng nước. Nhiều biến khác nhau thực chất là những cách khác nhau để đạt cùng các mục tiêu đó.',
    ],
    examples: [
      { line: 'nt-tien3tot', ply: 1, note: 'Pháo đầu: tranh trung lộ ngay nước đầu.' },
      { line: 'nt-tien3tot', ply: 2, note: 'Một nước làm hai việc: ra quân và giữ tốt giữa.' },
      { line: 'nt-tien3tot', ply: 5, note: 'Ra xe sớm trên cột vừa được dọn trống.' },
      { line: 'nt-tien3tot', ply: 7, note: 'Tiến tốt 3 để thông chân mã — phối hợp quân.' },
    ],
  },
  {
    id: 'bon-cau-hoi', title: '2. Bốn câu hỏi cho mỗi nước đi',
    body: [
      '① Nước này <b>làm gì</b>? ② Nước trước của đối phương <b>muốn gì</b>, nước này đáp lại ra sao? ③ <b>Nếu không đi</b> nước này thì chuyện gì xảy ra? ④ Sau nước này, <b>quân nào của mình còn chưa hoạt động</b>?',
      'Câu ③ quan trọng nhất. Trong phần "Vì sao?", app cho bên đi "bỏ lượt" rồi nhờ engine tìm đòn của đối phương — đó chính là câu trả lời cho câu ③.',
    ],
    examples: [
      { line: 'nt-binh-phao-doi-xe', ply: 11, note: 'Xe đang bị dọa: nếu không tránh sẽ mất quân.' },
      { line: 'nt-phao-qua-ha', ply: 14, note: 'Vừa tránh đòn vừa tạo đe dọa — nước "hai trong một".' },
    ],
  },
  {
    id: 'vat-chat', title: '3. Giá trị quân và khi nào nên đổi quân',
    body: [
      'Quy đổi tạm: <b>xe 9</b>, <b>pháo 4.5</b>, <b>mã 4</b>, sĩ / tượng 2, tốt 1 (tốt đã qua sông 2). Đầu ván pháo thường mạnh hơn mã; về tàn cuộc mã thường mạnh hơn.',
      'Nguyên tắc đổi quân: <b>đang hơn quân thì đổi</b> để đơn giản hóa về tàn cuộc; <b>đang kém quân thì tránh đổi</b>, giữ thế phức tạp. Chênh nhau một tốt thì độ hoạt động của quân thường quan trọng hơn con số.',
    ],
    examples: [
      { line: 'nb-tien-tot-giua', ply: 13, note: 'Đổi xe: đếm lại vật chất sau khi hai bên ăn qua ăn lại.' },
      { line: 'nb-tien-tot-giua', ply: 'end', factor: 'material' },
    ],
  },
  {
    id: 'an-toan-tuong', title: '4. An toàn tướng',
    body: [
      'Hai câu hỏi: <b>còn bao nhiêu sĩ tượng</b> che cung, và <b>bao nhiêu quân địch đang khống chế cung</b> (xe, pháo, mã, tốt có đường vào các ô trong cung).',
      'Cung yếu thì ưu tiên củng cố hoặc đổi bớt quân tấn công của địch. Cung đối phương yếu thì dồn thêm quân vào cánh có tướng địch — tấn công cần ít nhất 2–3 quân phối hợp.',
    ],
    examples: [
      { line: 'nt-tien3tot', ply: 16, note: 'Lên sĩ củng cố cung trước khi đối phương kịp tấn công.' },
      { line: 'nt-tien3tot', ply: 'end', factor: 'king' },
    ],
  },
  {
    id: 'quan-kem-nhat', title: '5. Tìm quân kém hoạt động nhất',
    body: [
      'Khi không có đòn chiến thuật nào, một kế hoạch rất tốt là: <b>tìm quân kém hoạt động nhất của mình và cải thiện nó</b>. Thường đó là xe chưa ra, mã bị cản chân hoặc pháo không có ngòi.',
      'Ngược lại, quân kém nhất của đối phương là mục tiêu: giữ cho nó bị kẹt càng lâu càng tốt.',
    ],
    examples: [
      { line: 'nl-xe-tuan-ha', ply: 'end', factor: 'activity' },
      { line: 'nt-phao-qua-ha', ply: 10, note: 'Tiến pháo: vừa nhắm tốt giữa vừa mở đường cho xe 8 đang bị kẹt.' },
    ],
  },
  {
    id: 'tuyen-then-chot', title: '6. Tuyến then chốt: hàng tuần hà, cột thông, trung lộ',
    body: [
      '<b>Xe tuần hà</b> (đứng ở bờ sông bên mình) khống chế cả hàng ngang, cản tốt và mã đối phương vượt sông. <b>Xe qua hà</b> xâm nhập, uy hiếp tốt và quân non. <b>Cột thông</b> là cột phía trước xe không có quân mình chắn.',
      '<b>Pháo trung lộ</b> nhắm thẳng cột tướng luôn là mối đe dọa thường trực — vì vậy bên phòng thủ hay giữ tốt giữa và mã bảo vệ trung lộ.',
    ],
    examples: [
      { line: 'nt-tien3tot', ply: 15, note: 'Xe tuần hà.' },
      { line: 'nt-tien3tot', ply: 17, note: 'Xe qua hà, nhắm các tốt chưa được bảo vệ.' },
      { line: 'nt-tien3tot', ply: 'end', factor: 'lines' },
    ],
  },
  {
    id: 'tot-qua-song', title: '7. Tốt qua sông',
    body: [
      'Tốt chưa qua sông chỉ đi thẳng; qua sông rồi được <b>đi ngang</b>, sức tấn công tăng gấp đôi. Tốt càng gần cung địch càng nguy hiểm, nhưng tốt đi một mình dễ bị ăn — cần xe, mã hoặc pháo yểm trợ.',
      'Ở trung cuộc, đổi tốt ở trung lộ hay ở cánh thường mở đường cho xe, mã — hãy hỏi: sau khi đổi, cột / đường nào được mở ra và có lợi cho ai?',
    ],
    examples: [
      { line: 'nt-phao-qua-ha', ply: 22, note: 'Tốt qua sông và lập tức dọa ăn tốt 3 của Đỏ.' },
      { line: 'nb-xe-qua-ha', ply: 16, note: 'Tốt 7 ăn tốt và qua sông — đổi tốt mở ra cột 7.' },
    ],
  },
  {
    id: 'phong-thu', title: '8. Phòng thủ: tránh, bảo vệ, chặn hay phản đòn',
    body: [
      'Khi một quân bị dọa, có bốn cách đáp: <b>tránh đi</b>, <b>bảo vệ</b> nó, <b>chặn đường</b> tấn công, hoặc <b>phản đòn</b> mạnh hơn (đe dọa quân giá trị hơn, chiếu tướng).',
      'Cách tốt nhất thường là cách vừa giải nguy vừa làm thêm được việc khác — ví dụ tránh đòn bằng một nước tạo đe dọa mới.',
    ],
    examples: [
      { line: 'nt-binh-phao-doi-xe', ply: 17, note: 'Tránh đòn.' },
      { line: 'nt-binh-phao-doi-xe', ply: 22, note: 'Lui mã: chặn đường tấn công, bảo vệ tốt và mở đòn dọa xe — một nước nhiều việc.' },
    ],
  },
  {
    id: 'quy-trinh', title: '9. Quy trình nghĩ trước mỗi nước',
    body: [
      '<b>Bước 1 — Đối phương vừa đe dọa gì?</b> Chiếu, dọa ăn, bắt đôi. Luôn trả lời câu này trước.',
      '<b>Bước 2 — Mình có nước cưỡng ép không?</b> Xét theo thứ tự: chiếu → ăn quân → dọa ăn.',
      '<b>Bước 3 — Không có thì chọn kế hoạch</b> theo 6 yếu tố: vật chất, an toàn tướng, hoạt động, tuyến then chốt, tốt qua sông, điểm yếu.',
      '<b>Bước 4 — Kiểm tra an toàn</b> trước khi buông tay: nước này có để lại quân không được bảo vệ, hay mở đường cho đối phương không?',
      'Luyện quy trình này ở mục <b>Đọc thế trận</b> ngay bên dưới.',
    ],
    examples: [{ line: 'nt-tien3tot', ply: 'end', factor: 'all' }],
  },
];
