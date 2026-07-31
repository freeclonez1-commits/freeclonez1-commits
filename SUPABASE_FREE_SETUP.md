# Setup free backend: Netlify Functions + Supabase

Muc tieu: chi dung free tier, tat may tinh van xem duoc dashboard va tracker van gui log ve duoc.

## 1. Tao Supabase project free

1. Vao https://supabase.com
2. Tao project moi.
3. Vao **SQL Editor** va chay SQL nay:

```sql
create table if not exists public.app_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_state (key, value)
values (
  'default',
  '{
    "stores": [],
    "logs": [],
    "blacklist": [],
    "autoStoreId": 1,
    "autoLogId": 1,
    "autoBlacklistId": 1
  }'::jsonb
)
on conflict (key) do nothing;
```

4. Vao **Project Settings > API** va lay:
   - Project URL
   - service_role key

Can giu `service_role key` bi mat. Chi dat trong Netlify environment variables, khong dua vao frontend/config.js.

## 2. Deploy len Netlify tu GitHub

Netlify Functions can deploy tot nhat qua GitHub repo, khong nen dung Netlify Drop cho ban co backend.

Netlify settings:

- Build command:

```bash
npm ci --prefix dashboard && npm run build --prefix dashboard
```

- Publish directory:

```txt
dashboard/dist
```

- Functions directory:

```txt
netlify/functions
```

File `netlify.toml` da cau hinh san cac redirect:

- `/api/v1/*` -> Netlify Function API
- `/client-tracker.js` -> Netlify Function tracker
- `/health` -> Netlify Function health check

## 3. Dat Environment Variables tren Netlify

Trong Netlify > Site configuration > Environment variables, them:

```env
ADMIN_API_KEY=your-private-admin-login-key
DATA_ENCRYPTION_KEY=your-private-long-random-encryption-key
BUSINESS_TIME_ZONE=Asia/Ho_Chi_Minh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Khong dat cac key nay vao:

- `dashboard/public/config.js`
- `deploy-netlify-fixed/config.js`
- Sapo theme
- GitHub public repo

## 4. Cau hinh dashboard Netlify

Vi backend da nam cung domain Netlify, `config.js` co the de API local:

```js
window.SAPO_GUARD_CONFIG = {
  API_BASE_URL: ''
};
```

Dashboard se goi `/api/v1` tren chinh `https://vuaip.netlify.app`.

## 5. Script dan vao Mysapo

Sau khi deploy Netlify xong, moi store Mysapo dan:

```html
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "https://vuaip.netlify.app"
  };
</script>
<script src="https://vuaip.netlify.app/client-tracker.js" async></script>
```

## 6. Kiem tra

Mo:

```txt
https://vuaip.netlify.app/health
```

Neu thay JSON `status: OK`, backend Netlify Function da chay.

Mo dashboard:

```txt
https://vuaip.netlify.app
```

Nhap `ADMIN_API_KEY` da dat trong Netlify environment variables.

## Ghi chu free tier

- Netlify Free co credit/thang. Neu traffic qua cao co the cham/hit limit.
- Supabase Free co database gioi han va co the pause sau 1 tuan khong hoat dong.
- Phuong an nay phu hop de dung free va test/thuc chien nho. Khi co don/log nhieu nen nang cap backend/database.
