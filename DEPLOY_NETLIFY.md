# Deploy dashboard len Netlify

## 1. Netlify chi host dashboard

Dashboard React co the deploy len Netlify. Backend Express khong nen dua truc tiep vao Netlify Function khi van dung `server/database.json`, vi du lieu logs/blacklist/store can ghi ben vung.

Khuyen nghi:
- Netlify: host `dashboard`.
- Backend: host rieng tren Render/Railway/Fly/VPS hoac chuyen sang database that neu muon dung serverless.

## 2. Bien moi truong tren Netlify

Neu deploy tu Git va de Netlify tu build, trong Netlify site settings them:

```env
VITE_API_BASE_URL=https://your-backend-domain.com/api/v1
```

Vi du khi backend dang di qua tunnel:

```env
VITE_API_BASE_URL=https://bxkqeu-ip-171-224-0-81.tunnelmole.net/api/v1
```

Neu deploy bang ZIP thu cong, Netlify khong build lai env. Hay sua truc tiep file `config.js` trong goi deploy:

```js
window.SAPO_GUARD_CONFIG = {
  API_BASE_URL: 'https://your-backend-domain.com/api/v1'
};
```

Khong dat `ADMIN_API_KEY`, Sapo API Key, hoac API Secret vao `config.js`.

## 3. Cau hinh build

File `netlify.toml` o root da cau hinh:

```toml
[build]
  command = "npm ci --prefix dashboard && npm run build --prefix dashboard"
  publish = "dashboard/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## 4. Backend CORS

Backend da cho phep dashboard tu `*.netlify.app`. Khi co domain Netlify rieng, nen set them tren backend:

```env
DASHBOARD_ORIGINS=https://your-dashboard.netlify.app
```

Neu co nhieu domain, ngan cach bang dau phay:

```env
DASHBOARD_ORIGINS=https://site-a.netlify.app,https://admin.your-domain.com
```

## 5. Sau khi co URL production

Cap nhat ma nhung Sapo de tracker tro ve backend production:

```html
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "https://your-backend-domain.com"
  };
</script>
<script src="https://your-backend-domain.com/client-tracker.js" async></script>
```
