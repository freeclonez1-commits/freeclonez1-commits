# Deploy backend 24/7

Muc tieu: tat may tinh van xem dashboard tren dien thoai/may khac va tracker Sapo van gui log ve duoc.

Kien truc dung:

- Netlify: host dashboard `https://vuaip.netlify.app`
- Backend 24/7: host Express server tren Render/Railway/Fly/VPS
- Database file: luu vao persistent disk/volume, khong luu tam trong filesystem mac dinh cua host

## Cach khuyen nghi: Render Web Service + Persistent Disk

Render phu hop vi Express Node app chay nhu web service va co public HTTPS URL dang `https://ten-service.onrender.com`.

### 1. Dua code len GitHub

Khong commit file secret:

- `server/.env`
- `server/database.json` neu khong muon dua du lieu/log hien tai len cloud
- `node_modules`
- cac file log local

Neu chua co `.gitignore`, tao `.gitignore` voi noi dung:

```gitignore
node_modules/
.env
*.log
dashboard/dist/
deploy-netlify/
deploy-netlify-fixed/
*.zip
```

### 2. Tao Render Web Service

Tren Render:

1. New > Web Service
2. Connect GitHub repo
3. Root Directory: `server`
4. Runtime: Node
5. Build Command:

```bash
npm install
```

6. Start Command:

```bash
npm start
```

7. Health Check Path:

```txt
/health
```

### 3. Them Environment Variables tren Render

Dat cac bien nay trong Render Environment:

```env
ADMIN_API_KEY=your-private-admin-key
DATA_ENCRYPTION_KEY=your-private-long-encryption-key
BUSINESS_TIME_ZONE=Asia/Ho_Chi_Minh
DASHBOARD_ORIGINS=https://vuaip.netlify.app
DATA_DIR=/var/data
```

Khong dua cac gia tri nay vao frontend/Netlify/config.js.

### 4. Gan Persistent Disk tren Render

Trong Render service > Advanced/Disks:

- Mount Path: `/var/data`
- Size: chon nho nhat co the, vi file JSON ban dau rat nho

Ly do: backend dang ghi logs/blacklist/stores vao `database.json`. Neu khong co disk, du lieu co the mat khi host redeploy/restart.

### 5. Sau khi Render deploy xong

Lay backend URL, vi du:

```txt
https://sapo-ip-guard.onrender.com
```

Kiem tra:

```txt
https://sapo-ip-guard.onrender.com/health
```

Neu thay JSON status OK la backend song.

### 6. Cap nhat Netlify dashboard

Sua `deploy-netlify-fixed/config.js`:

```js
window.SAPO_GUARD_CONFIG = {
  API_BASE_URL: 'https://sapo-ip-guard.onrender.com/api/v1'
};
```

Sau do zip/upload lai dashboard len Netlify.

### 7. Cap nhat script trong theme Mysapo

Trong moi store Mysapo, script phai tro ve backend Render, khong tro ve Netlify:

```html
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "https://sapo-ip-guard.onrender.com"
  };
</script>
<script src="https://sapo-ip-guard.onrender.com/client-tracker.js" async></script>
```

## Ghi chu quan trong

- Netlify dashboard khong phai backend. Khong dung `https://vuaip.netlify.app/api/v1` lam API URL.
- `ADMIN_API_KEY` chi nam trong backend env va duoc nhap luc dang nhap dashboard.
- Sapo API Key/API Secret chi nhap trong dashboard, backend se ma hoa secret khi luu.
- Tunnelmole/localtunnel chi phu hop test nhanh. Muon 24/7 thi dung backend cloud co HTTPS co dinh.
