# V6 – Bám sát dung lượng tối đa

- Xem giá trị nhập là trần cứng: nhập 4 MB thì kết quả không vượt 4 MB.
- Vùng mong muốn 95–100%: mục tiêu 4 MB ưu tiên 3,8–4,0 MB.
- Tăng candidate mẫu lên 20 trên Render Free và 32 trên VPS.
- Dùng tối đa 2 lần tinh chỉnh trên RAM thấp, 3 lần trên VPS.
- Lưu bản tốt nhất xuống ổ đĩa giữa các lần dựng để tránh giữ nhiều PDF trong RAM.
- Nếu lần đầu ra 3,02 MB, thuật toán tăng DPI/JPEG có kiểm soát rồi thử lại.
- Nếu lần sau vượt 4 MB, thuật toán giảm nhẹ và thử lần cuối; luôn trả bản gần 4 MB nhất nhưng không vượt trần.
