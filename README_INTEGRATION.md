# دليل دمج الخادم وقاعدة البيانات في مشروع الواجهة الجديدة (Bolt.new / Antigravity)

مرحباً بك! هذا الدليل يوضح لك كيفية دمج حزمة الخادم وقاعدة البيانات ومحرك البرمجة الذكي داخل مشروع واجهتك الجديدة بسهولة تامة.

---

## 📁 محتويات الحزمة المرفقة:

1. **`data/app.db`**: ملف قاعدة بيانات SQLite الفعلي (22 جدولاً) يشمل المشاريع وذاكرة القرارات وسجل الإصلاحات.
2. **`server_backend/`**: الأكواد المصدرية الكاملة للخادم والباك إند:
   - `db/database.js`: إدارة الاتصال بقاعدة البيانات وهجرات الجداول بنمط WAL.
   - `services/engineer/`: محرك البرمجة الذكي (أوركسترا النماذج، بيئة الفحص المعزولة، مكتبة المعرفة RAG، ذاكرة المشروع، وحزمة التقييم القياسية).
   - `services/builderService.js`: دورة حياة مشاريع التطبيقات وإدارتها.
   - `routes/builderRoutes.js`: مسارات API للتحكم في المشاريع.
3. **`backendBridge.ts`**: جسر الربط البرمجي السلس للعمل مع TypeScript و Express في مشروعك الجديد.
4. **`server_integration_code.txt`**: كود التفعيل المباشر المكون من سطرين.

---

## 🛠️ خطوات الدمج في مشروع الواجهة الجديدة:

### الخطوة 1: وضع الملفات في مشروعك
انسخ محتويات هذا المجلد إلى مشروع واجهتك الجديدة كالتالي:
- ضع مجلد `data/` في جذر مشروعك الجديد: `المنصة الجديدة/data/`
- ضع مجلد `server_backend/` في جذر مشروعك الجديد: `المنصة الجديدة/server_backend/`
- انقل ملف `backendBridge.ts` إلى داخل مجلد: `المنصة الجديدة/src/backendBridge.ts`

### الخطوة 2: تفعيل الجسر في `server.ts`
افتح ملف `server.ts` في مشروعك وأضف:
```typescript
// أضف هذا السطر في أعلى الملف:
import { attachBackendAndDatabase } from './src/backendBridge';

// وأضف هذا السطر داخل دالة startServer() بعد السطر const app = express(); مباشرة:
attachBackendAndDatabase(app);
```

### الخطوة 3: تشغيل الخادم
```bash
npm run dev
```

ستشاهد في شاشة الكونسول:
```text
[Engineer Backend] ✅ تم الاتصال بقاعدة بيانات SQLite: data/app.db (22 جدولاً موثقاً)
[Engineer Backend] 🚀 تم تفعيل مسارات SQLite ومحرك Engineer بنجاح على /api/engineer/ و /api/sqlite/
Bolt.new Studio full-stack server listening on http://localhost:3000
```

---

## 🌐 المسارات الجديدة المتاحة للواجهة:
- `GET /api/sqlite/projects`: جلب جميع المشاريع من قاعدة البيانات الحقيقية.
- `POST /api/engineer/orchestrate`: تشغيل أوركسترا النماذج والبرمجة الذاتية للتطبيقات.
- `GET /api/engineer/memory/:projectId`: استرجاع ذاكرة المشروع والحلول السابقة.
- `POST /api/engineer/knowledge`: البحث واسترجاع التوثيق البرمجي (RAG).
- `GET /api/engineer/benchmarks`: فحص معايير الجودة والتقييم القياسي.
