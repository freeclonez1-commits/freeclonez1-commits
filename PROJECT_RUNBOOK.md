# Sapo IP Guard - Project Runbook

Cap nhat: 31/07/2026

File nay ghi lai thong tin van hanh du an va quy trinh lam viec hien tai. Khong luu admin key, Sapo API Secret, Supabase service role key, token GitHub, mat khau, hoac bat ky thong tin bi mat nao trong file nay.

## 1. Tong quan du an

Sapo IP Guard la dashboard giam sat IP cho website Sapo/Mysapo. He thong gom dashboard quan tri, API serverless tren Netlify Functions, database Supabase va script tracker dan vao theme Sapo.

Muc tieu chinh:

- Ghi nhan luot tuong tac tren website Sapo.
- Phat hien IP datacenter, VPN, proxy, Cloudflare/WARP hoac IP ket noi bat thuong.
- Bat WebRTC public IP khi trinh duyet cung cap du lieu nay.
- Dong bo don hang tu Sapo Admin API.
- Gan don hang voi phien truy cap neu co du lieu phu hop.
- Chan va bo chan IP tu dashboard.
- Hien thi log theo hai che do: `Chi Don Hang` va `Tat Ca`.

Production hien tai:

- Dashboard/API/tracker: `https://vuaip.netlify.app`
- Health check: `https://vuaip.netlify.app/health`
- Sapo store dang ket noi: `vua-do-hieu.mysapo.net`
- GitHub remote: `https://github.com/freeclonez1-commits/freeclonez1-commits.git`

## 2. Kien truc hien tai

Thanh phan chinh:

- `dashboard/`: React + Vite dashboard.
- `netlify/functions/api.js`: API serverless production, tracker script endpoint va xu ly Supabase state.
- `server/`: backend Express local cu, van huu ich de tham khao/dev local nhung production hien dang dung Netlify Functions.
- Supabase `app_state`: luu state JSON cho stores, logs, blacklist va counter id.
- Netlify: host frontend, API function va route `/client-tracker.js`.
- Sapo theme: dan script tracker de gui log ve Netlify.

Route production quan trong:

- `/health`: kiem tra API song.
- `/api/v1/stores`: quan ly store Sapo.
- `/api/v1/stores/:id/sync`: dong bo don hang Sapo.
- `/api/v1/logs`: lay logs/don hang.
- `/api/v1/blacklist`: them/xoa/check IP bi chan.
- `/client-tracker.js`: script tracker duoc nhung vao theme Sapo.

## 3. Bien moi truong bat buoc

Dat trong Netlify Environment Variables, khong dat trong frontend/config.js, GitHub public repo hay Sapo theme:

```env
ADMIN_API_KEY=...
DATA_ENCRYPTION_KEY=...
BUSINESS_TIME_ZONE=Asia/Ho_Chi_Minh
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Ghi chu bao mat:

- `ADMIN_API_KEY` la khoa dang nhap dashboard, khong ghi vao tai lieu.
- `DATA_ENCRYPTION_KEY` dung de ma hoa Sapo API Secret, khong duoc doi tuy tien neu da co store da luu secret.
- `SUPABASE_SERVICE_ROLE_KEY` chi dung o backend Netlify Function.
- Sapo API Secret chi nhap trong dashboard, backend ma hoa roi luu, frontend khong duoc doc lai secret goc.

## 4. Cau hinh Netlify

File cau hinh: `netlify.toml`

Build command:

```bash
npm ci --prefix dashboard && npm run build --prefix dashboard
```

Publish directory:

```txt
dashboard/dist
```

Functions directory:

```txt
netlify/functions
```

Redirect quan trong:

- `/api/v1/*` -> `/.netlify/functions/api/api/v1/:splat`
- `/health` -> `/.netlify/functions/api/health`
- `/client-tracker.js` -> `/.netlify/functions/api/client-tracker.js`
- `/*` -> `/index.html`

## 5. Cau hinh dashboard

File public config:

```js
window.SAPO_GUARD_CONFIG = {
  API_BASE_URL: ''
};
```

Voi production cung domain Netlify, de `API_BASE_URL` rong de dashboard goi API qua chinh domain `https://vuaip.netlify.app`.

Tuyet doi khong dua cac gia tri nay vao config public:

- Admin key
- Sapo API Key
- Sapo API Secret
- Supabase URL neu di kem service role key
- Supabase service role key
- Data encryption key

## 6. Quy trinh them store Sapo moi

1. Vao Sapo Admin cua store can ket noi.
2. Tao hoac mo Private App.
3. Lay `API Key` va `API Secret`.
4. Dam bao app co quyen doc don hang.
5. Mo dashboard `https://vuaip.netlify.app`.
6. Dang nhap bang admin key da dat tren Netlify.
7. Vao `Lien ket Mysapo (Stores)`.
8. Bam `Them cua hang`.
9. Nhap:
   - Ten cua hang
   - Mysapo domain, vi du `ten-shop.mysapo.net`
   - API Key
   - API Secret
10. Luu store.
11. Bam `Kiem tra Sapo` neu can xac minh lai.
12. Sang `Ma nhung Sapo` de lay script tracker.

## 7. Script dan vao theme Sapo

Script production can tro ve Netlify:

```html
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "https://vuaip.netlify.app"
  };
</script>
<script src="https://vuaip.netlify.app/client-tracker.js" async></script>
```

Vi tri dan:

1. Vao Sapo Admin.
2. Vao Giao dien.
3. Chon chinh sua HTML/CSS.
4. Tim file theme/layout chua the `</head>`.
5. Dan script truoc `</head>`.
6. Luu theme.
7. Mo website Sapo tren mot may/trinh duyet khac va click thu de tao log.

Luu y:

- Sau khi script da dan vao theme production, tat may tinh ca nhan van khong lam mat tracker vi API/tracker dang chay tren Netlify.
- Neu doi domain backend, phai cap nhat lai script trong theme.

## 8. Quy trinh dong bo don Sapo

Tu dashboard:

1. Chon store o header.
2. Bam `Dong bo don Sapo`.
3. He thong goi Sapo Admin API va lay don tao trong ngay theo mui gio `Asia/Ho_Chi_Minh`.
4. Vao `Lich su Logs & IP`.
5. Che do `Chi Don Hang` phai hien dung tong so don hom nay.

Ket qua mong muon:

- Don co `client_details.browser_ip` tu Sapo se hien `IP Ket noi`.
- Don co phien tracker khop se co WebRTC neu tracker da bat duoc.
- Don khong khop phien tracker se hien `Chua/Chưa bat duoc phien`.
- Khong duoc tinh duration tu moc Unix 1970.
- Khong duoc danh `unknown` la IP an toan.

## 9. Logic IP va WebRTC can nho

`IP Ket noi`:

- Lay tu Netlify forwarded header khi tracker ghi log.
- Khi sync don Sapo, lay tu `order.client_details.browser_ip` neu Sapo tra ve.

`IP WebRTC`:

- Chi co khi browser cua khach cung cap public IP qua WebRTC va tracker gui duoc ve API.
- Don chi dong bo tu Sapo se khong tu co WebRTC neu khong co log tracker khop phien.
- Neu WebRTC khac IP ket noi, dashboard danh canh bao fake IP.
- Neu WebRTC trung IP ket noi, dashboard danh IP that an toan neu khong co dau hieu datacenter/VPN.

Hien thi IPv6:

- Trong bang: rut gon de khong vo layout, vi du `2a09:bac5:398f:16c8::2...`.
- Trong modal `Chi tiet`: hien IP day du.

## 10. Quy trinh chan va bo chan IP

Chan IP:

1. Vao `Lich su Logs & IP`.
2. Chon row can chan.
3. Bam `Chan IP`.
4. Neu row co ca IP ket noi va WebRTC khac nhau, he thong co the them ca hai IP vao blacklist.
5. Script tracker tren Sapo se doc blacklist tu `/client-tracker.js` va hien man hinh bi chan.

Bo chan IP:

1. Vao row da chan hoac `Danh sach den`.
2. Bam `Bo Chan IP`.
3. F5 website Sapo de kiem tra lai.

Luu y:

- Neu IP la `unknown`, UI khong cho chan vi khong co IP hop le.
- Tracker chan o tang trinh duyet/theme. Neu can chan truoc khi trang render, can them WAF/server-side rule ngoai he thong nay.

## 11. Quy trinh dev local

Dashboard local:

```bash
npm.cmd run dev --prefix dashboard
```

Build dashboard:

```bash
npm.cmd run build --prefix dashboard
```

Kiem tra function syntax:

```bash
node --check netlify/functions/api.js
```

Backend Express local cu:

```bash
npm.cmd run dev --prefix server
```

Khi test production, uu tien:

1. Build local pass.
2. `git diff --check` pass.
3. Commit.
4. Push `main`.
5. Cho Netlify deploy.
6. Mo `https://vuaip.netlify.app/health`.
7. Mo dashboard va test UI thuc te.

## 12. Quy trinh deploy production

1. Kiem tra thay doi:

```bash
git status --short
git diff --check
```

2. Kiem tra API:

```bash
node --check netlify/functions/api.js
```

3. Build dashboard:

```bash
npm.cmd run build --prefix dashboard
```

4. Commit:

```bash
git add <files>
git commit -m "Mo ta ngan gon"
```

5. Push:

```bash
git push origin main
```

6. Doi Netlify auto deploy xong.
7. Kiem tra:

```txt
https://vuaip.netlify.app/health
```

8. Vao dashboard, sync don va kiem tra Logs.

## 13. Test case chuan sau khi sua loi

Dashboard:

- Vao duoc `https://vuaip.netlify.app`.
- Dang nhap thanh cong bang admin key.
- Header hien store dang chon.
- Bam `Dong bo don Sapo` khong bi 401 neu API Key/Secret dung.
- `Chi Don Hang` hien dung so don hom nay.
- `Tat Ca` hien 20 log gan nhat neu co log tracker.

Don hang:

- Khong con duration dang hang chuc trieu phut.
- Don khong co phien khop hien `Chưa bắt được phiên`.
- Don co `browser_ip` tu Sapo hien IP ket noi va phan tich ISP/quoc gia.
- IP fake/datacenter hien canh bao do.
- IP that Viettel/VNPT/FPT khong bi danh fake neu khong co dau hieu VPN/datacenter.

WebRTC:

- Neu tracker bat duoc WebRTC khac IP ket noi, hien `(khac IP ket noi)`.
- Neu WebRTC trung IP ket noi, hien `(trung IP ket noi)`.
- Neu khong bat duoc WebRTC, hien `—`.

IPv6:

- Bang chi hien IP rut gon.
- Modal chi tiet hien IP day du.

Blacklist:

- Chan IP xong Sapo theme hien man hinh bi chan.
- Bo chan IP xong F5 website Sapo vao lai duoc.
- Khong cho chan IP `unknown`.

Toast/thong bao:

- Thong bao thanh cong/that bai nen tu mat sau khoang 5 giay.
- Khong bat nguoi dung phai bam `x` moi mat, tru khi do la thong bao quan trong can hanh dong.

## 14. Loi thuong gap va cach xu ly

Loi `Sapo tu choi xac thuc (401)`:

- API Key/API Secret sai.
- Key/Secret khong thuoc dung store.
- Private App da bi tat hoac tao lai secret.
- Mo `Lien ket Mysapo`, nhap lai API Key/Secret, luu va bam `Kiem tra Sapo`.

Dong bo 0 don:

- Kiem tra store dang chon.
- Kiem tra ngay hien tai theo mui gio `Asia/Ho_Chi_Minh`.
- Kiem tra Sapo co don trong ngay khong.
- Kiem tra quyen doc Orders cua Private App.

Da luu API Secret nhung reload mat:

- Kiem tra Netlify env `DATA_ENCRYPTION_KEY` co on dinh khong.
- Khong doi encryption key sau khi da luu store.
- Kiem tra Supabase `app_state` co key `stores` rieng va khong bi log ghi de.

IP van vao duoc sau khi chan:

- Kiem tra script trong theme Sapo co tro ve `https://vuaip.netlify.app` khong.
- Mo `/client-tracker.js` de dam bao blacklist moi duoc phat ra.
- Hard refresh website Sapo.
- Neu can chan truoc khi trang load, can them WAF/server-side rule.

WebRTC khong bat duoc:

- Mot so trinh duyet/VPN an WebRTC hoac chan local candidate.
- Truong hop nay he thong chi co IP ket noi.
- Neu IP ket noi la datacenter/VPN thi van co the canh bao fake IP.

## 15. Cac file nen doc khi bao tri

- `netlify/functions/api.js`: API production, sync Sapo, tracker source, blacklist.
- `dashboard/src/components/LogsTable.jsx`: bang Logs, modal chi tiet, chan/bo chan.
- `dashboard/src/components/StoreManager.jsx`: quan ly store va API key.
- `dashboard/src/components/ScriptGenerator.jsx`: tao ma nhung Sapo.
- `dashboard/src/api/client.js`: client API calls.
- `dashboard/src/App.jsx`: state tong va luong fetch.
- `SUPABASE_FREE_SETUP.md`: huong dan Supabase free.
- `DEPLOY_NETLIFY.md`: thong tin deploy Netlify.

## 16. Trang thai gan nhat da xac nhan

Da xac nhan tren production:

- Netlify deploy tu GitHub thanh cong.
- Health endpoint hoat dong.
- Store `vua-do-hieu.mysapo.net` ket noi Sapo thanh cong.
- Dong bo duoc 10 don trong ngay 31/07/2026.
- Duration loi hang chuc trieu phut da duoc fix.
- Don sync tu Sapo lay duoc `browser_ip` va phan tich IP.
- Bang rut gon IPv6, modal giu IP day du.
- Che do `Tat Ca` hien WebRTC mismatch khi tracker bat duoc.

Commit lien quan gan nhat:

- `74226ef` - Fix Sapo order IP analysis and durations
- `856df7e` - Polish order duration labels

