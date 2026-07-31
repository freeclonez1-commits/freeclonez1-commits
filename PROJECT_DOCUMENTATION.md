# SAPO IP GUARD — TÀI LIỆU DỰ ÁN HỆ THỐNG GIÁM SÁT FAKE IP & ĐỒNG BỘ ĐƠN SAPO

---

## 📌 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)

**Sapo IP Guard Multi-Store System** là giải pháp phần mềm chuyên biệt hỗ trợ các chủ doanh nghiệp và cửa hàng thương mại điện tử trên nền tảng **Sapo Web / Mysapo** phát hiện, ngăn chặn và quản lý các hành vi **đặt đơn ảo, sử dụng IP Fake / VPN / Proxy**, trích xuất **IP Gốc Thực Tế (WebRTC Leak)** và bảo vệ website bán hàng theo thời gian thực.

### 🌟 Mục tiêu chính:
1. **Phát hiện Fake IP / VPN / Proxy:** Tự động nhận diện các dải IP Datacenter Hosting (GTHost, DigitalOcean, Linode, AWS, NordVPN, v.v.) đang cố tình ẩn danh khi vào trang web hoặc đặt đơn.
2. **Trích xuất IP Gốc Thực Tế (WebRTC Leak Detection):** Khai thác lỗ hổng rò rỉ WebRTC trên trình duyệt để tìm ra địa chỉ IP mạng thật (Viettel, VNPT, FPT...) của người dùng dù họ đang bật VPN.
3. **Tính toán thời gian thao tác của User:** Tính chính xác khoảng thời gian từ lúc khách hàng bước chân vào website cho đến khi chốt đơn hàng (ví dụ: `1 phút 10 giây` vs `⚡ 8 giây (Đặt cực nhanh)`).
4. **Đồng bộ đơn hàng tự động từ Sapo Admin API:** Trích xuất 100% đơn hàng thực tế từ Sapo REST API `/admin/orders.json` kèm ngày giờ đặt hàng chuẩn (`created_on`).
5. **Chặn IP Kép & Khóa Truy Cập Real-Time:** Khi bấm **"Chặn IP"**, hệ thống lập tức khóa quyền truy cập đối với cả IP VPN lẫn IP Gốc trên website Sapo, hiển thị màn hình cảnh báo vi phạm **Luật An ninh mạng Việt Nam** theo chuẩn Apple System Typography.

---

## 🛠️ 2. QUÁ TRÌNH THỰC HIỆN & LỊCH SỬ NÂNG CẤP (DEVELOPMENT JOURNEY)

### 🔹 Giai đoạn 1: Khởi tạo & Sửa lỗi Mixed Content (HTTP ➔ HTTPS Tunnel)
- **Vấn đề:** Website Sapo chạy trên HTTPS (`https://vua-do-hieu.mysapo.net`). Nếu script tracker gọi về `http://localhost:5000`, trình duyệt Edge/Chrome sẽ chặn do lỗi Mixed Content.
- **Giải pháp:** Sử dụng `tunnelmole` tạo đường truyền HTTPS công khai bảo mật `https://pruiqe-ip-171-224-0-81.tunnelmole.net` trỏ trực tiếp về cổng backend 5000.

### 🔹 Giai đoạn 2: Xây dựng Sapo Sync Service (`sapoSyncService.js`)
- **Phát hiện bug Sapo API:** Sapo API trả về trường ngày tạo là `created_on` (thay vì `created_at`).
- **Giải pháp:** Xây dựng bộ phân tích ngày `parseSapoDate`, đồng bộ sạch **84 đơn hàng thực tế** từ Sapo Admin API với mốc thời gian chuẩn xác.

### 🔹 Giai đoạn 3: Tự động kế thừa IP Gốc (WebRTC IP Inheritance)
- **Vấn đề:** Đơn hàng kéo từ Sapo API chỉ chứa IP kết nối HTTP (`23.160.72.198`), trong khi lượt xem trang trước đó đã ghi nhận được IP thật (`171.224.0.81`).
- **Giải pháp:** Backend tự động đối chiếu cơ sở dữ liệu theo dải IP / phiên truy cập, giúp đơn hàng **tự động kế thừa IP Gốc `171.224.0.81`** rực rỡ và rõ ràng.

### 🔹 Giai đoạn 4: Tính toán thời gian thao tác của User (*User Time to Order*)
- **Giải pháp:** Script client ghi nhận mốc thời gian truy cập đầu tiên vào `sessionStorage`. Server tính toán hiệu số thời gian thực giữa lúc vào web và lúc hoàn tất đơn hàng.

### 🔹 Giai đoạn 5: Cơ chế Chặn IP Kép (Dual IP Blacklist Check) & Màn hình Pháp lý
- **Vấn đề:** Nếu người dùng dùng VPN, server nếu chỉ kiểm tra IP kết nối sẽ bỏ sót IP thật.
- **Giải pháp:**
  - Kiểm tra song song **IP Kết nối (VPN)** AND **IP Gốc Thực Tế (WebRTC)**.
  - Tự động thay thế giao diện website Sapo bằng màn hình cảnh báo nghiêm trang chuẩn **Apple System Typography**, trích dẫn:
    - **Luật An ninh mạng số 24/2018/QH14**
    - **Điều 288 Bộ luật Hình sự Nước Cộng hòa Xã hội Chủ nghĩa Việt Nam**
    - **Cục An ninh mạng & Phòng chống tội phạm công nghệ cao (A05 - Bộ Công an)**.

---

## 🏗️ 3. KIẾN TRÚC KỸ THUẬT & CẤU TRÚC THƯ MỤC (TECHNICAL ARCHITECTURE)

```
E:\Antigravity Vibe Code\CHECK IP
├── server/                               # BACKEND NODE.JS SERVER
│   ├── database.json                     # Database Emulator (Pure JS DB Engine)
│   ├── public/
│   │   └── client-tracker.js             # Script Tracking nhúng vào Sapo Theme
│   ├── src/
│   │   ├── index.js                      # Entry point Express API (Port 5000)
│   │   ├── db.js                         # Database Manager Engine
│   │   ├── routes/
│   │   │   ├── logs.js                   # API Thu thập & Truy vấn Logs/IP
│   │   │   ├── blacklist.js              # API Chặn/Bỏ chặn IP
│   │   │   ├── stores.js                 # API Quản lý Store Mysapo
│   │   │   └── stats.js                  # API Thống kê KPIs & Biểu đồ
│   │   └── services/
│   │       ├── ipService.js              # Tra cứu IP, VPN, Datacenter (IP-API / IPWhois)
│   │       └── sapoSyncService.js        # Đồng bộ đơn hàng Sapo Admin REST API
├── dashboard/                            # FRONTEND DASHBOARD (VITE REACT)
│   ├── src/
│   │   ├── App.jsx                       # Master Layout Component
│   │   ├── index.css                     # Apple Light Design System CSS
│   │   ├── api/client.js                 # API Integration Helpers
│   │   └── components/
│   │       ├── Header.jsx                # Thanh Header, Nút Đồng bộ & Refresh
│   │       ├── Sidebar.jsx               # Thanh điều hướng Menu
│   │       ├── Overview.jsx              # KPIs Dashboard & Biểu đồ Recharts
│   │       ├── LogsTable.jsx             # Bảng Đơn Hàng & Phân Tích IP Chi Tiết
│   │       ├── BlacklistManager.jsx      # Quản lý Danh Sách Đen
│   │       ├── StoreManager.jsx          # Liên kết & Cấu hình Sapo API Key
│   │       └── ScriptGenerator.jsx       # Trình tạo Mã Nhúng HTML
```

---

## 💻 4. TÍNH NĂNG NỔI BẬT CỦA HỆ THỐNG

| Tính năng | Mô tả chi tiết |
|---|---|
| 🛒 **Bảng Lọc Đơn Hàng Focus** | Chế độ **`🛒 Chỉ Đơn Hàng`** lọc sạch rác lượt xem trang, tập trung hiển thị 100% đơn hàng thực tế |
| 🔴 **Nhận diện IP Fake / VPN** | Tự động quét dải IP Datacenter (GTHost, DigitalOcean, AWS, NordVPN...) |
| 🟢 **Bắt IP Gốc (WebRTC Leak)** | Bắt trọn địa chỉ IP mạng thật (Viettel, VNPT, FPT...) ngay cả khi bật VPN |
| ⏱️ **Đo Thời Gian Đặt Hàng** | Tính chính xác số phút/giây từ lúc user vào web đến khi bấm chốt đơn |
| 🚫 **Chặn IP Kép 1-Click** | Chặn song song cả IP kết nối lẫn IP thật, hiển thị màn hình khóa Cảnh báo Pháp lý |
| 🟢 **Bỏ Chặn IP Nhanh** | Nút **`🟢 Bỏ Chặn IP`** cho phép gỡ chặn tức thì khi cần khôi phục quyền truy cập |
| ☁️ **Đồng bộ Sapo REST API** | Kết nối trực tiếp Sapo Admin API kéo đầy đủ đơn hàng cùng mốc thời gian chuẩn |

---

## 🚀 5. HƯỚNG DẪN TRIỂN KHAI & SỬ DỤNG

### 📥 1. Nhúng script vào Website Sapo (Mysapo):
1. Vào **Sapo Admin ➔ Giao diện ➔ Chỉnh sửa HTML/CSS**.
2. Mở file `theme.bwt` (hoặc `theme.biquyet.xml`).
3. Dán đoạn mã sau vào trước thẻ `</head>`:

```html
<!-- SAPO IP GUARD TRACKER SCRIPT -->
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "https://bxkqeu-ip-171-224-0-81.tunnelmole.net"
  };
</script>
<script src="https://bxkqeu-ip-171-224-0-81.tunnelmole.net/client-tracker.js" async></script>
```

### ⚡ 2. Chạy ứng dụng tại Local:
- **Backend (Port 5000):**
  ```bash
  cd server
  node src/index.js
  ```
- **Dashboard (Port 3000):**
  ```bash
  cd dashboard
  npm run dev
  ```
- **HTTPS Tunnel (Tunnelmole):**
  ```bash
  npx tunnelmole 5000
  ```

### Security and operation notes
- Set `ADMIN_API_KEY` and `DATA_ENCRYPTION_KEY` in `server/.env` before starting the backend. The dashboard asks for the admin key once per browser session.
- Sapo API secrets are encrypted at rest and are never returned to the dashboard API.
- The tracker can deny access in the browser, but it is not a server-side firewall. Apply Sapo checkout or WAF rules when an IP must be blocked before any browser code runs.
- Time-to-order is an estimate unless a checkout session can be matched directly to the final Sapo order.

---

*Tài liệu được khởi tạo và lưu trữ tự động vào dự án Sapo IP Guard.*
