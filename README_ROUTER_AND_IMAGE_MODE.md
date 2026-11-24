# الموجّه الذكي (7 طبقات) + وضع الصور — المرحلة 1

تسليم ملحقين معتمدين فوق منصة Engineer:
1. **Smart Intent Router** — منظومة توجيه من 7 طبقات فوق workspaceModelRouter.
2. **Image Mode — المرحلة 1** — طبقات العرض/التوجيه/المعالجة/الكاش المخصصة للمرحلة 1 من ملحق وضع الصور.

---

## أولاً: الموجّه الذكي للطلبات (Smart Intent Router)

### الطبقات السبع كما نُفذت

| الطبقة | الملف | التكلفة | ما تحقق فعلاً |
|---|---|---|---|
| 1. التطبيع والمرفقات | `routerNormalize.js` + `i18n/routerLexicon.js` | $0 | توحيد عربي + تصحيح إملائي على مستوى التوكن («سحراء→صحراء» موثقة في `corrections`) + حماية النصوص الحرفية (`protected_brand_text`) + رصد إشارات القناع/النقر/المرفق/الوضع اليدوي |
| 2. الفلترة الحتمية | `routerFastPath.js` | $0 | guardrail (400 قبل أي رصيد) + قناع→`image_edit`، نقرة→`ui_edit`، أوامر قاطعة (`remove_bg`/`upscale_4k`/`export_code`) — كلها <10ms وصفر استدعاءات نموذج (مُثبت بعدّاد تجسس) |
| 3. التصنيف والسياق | `routerClassifier.js` | $0 محلياً | 6 مسارات (`image_generate/image_edit/ui_generate/ui_edit/hybrid_ui_with_assets/chat_consult`)، كشف متابعة حتمي من آخر مخرجات الجلسة (telemetry) دون نموذج، ثم qwen2.5:7b عبر workspaceModelRouter بعزل XML وبلا Tool Calling |
| 4. الثقة وحسم الغموض | `smartRouter.js` | $0 | ≥0.80 تنفيذ، 0.50–0.79 خياران سريعان (`status: 'ambiguous'`، صفر استهلاك مدفوع)، شارة تصحيح بنقرة (`override_badge` + `POST /route/override`) |
| 5. التفكيك واختيار النموذج | `routerEnrich.js` | $0 | تفكيك hybrid إلى مهام أصول (hero/product/logo/storefront) مربوطة بالأوضاع ومصفوفة OCR، وترقية الواجهات المعقدة (≥2 إشارة تعقيد: رسوم بيانية/دفتر أوامر…) إلى `cloud_flash` |
| 6. الإثراء والمعاملات | `routerEnrich.js` | $0 | عقد JSON بالمواصفة (`intent/confidence/model_tier/ui_params{domain,platform,theme,direction,protected_brand_text}/asset_tasks[]`)، برومبت إنجليزي حتمي يحمل النص المحمي حرفياً كتعليمة عرض exact-render، ربط Brand Kit من قفل المشروع |
| 7. الاحتياط والتكلفة والقياس | `routerClassifier.js` + `routerTelemetry.js` + `routerLlm.js` | شبه $0 | مدقق Schema صارم (بدون اعتماديات) + كسر JSON ⇒ إعادة محلية واحدة ⇒ gemini-flash بصمت ⇒ سقوط كلمات مفتاحية بثقة مغطاة ≤0.79؛ سقف 3 محاولات؛ فحص حصة مسبق (`cost_check` + `cost_blocked`)؛ جدول `studio_routing_telemetry` (ترحيل 035) |

### نقاط API الجديدة
- `POST /api/studio/route` — العقد الكامل (يبقى حقل `mode` القديم للتوافق).
- `POST /api/studio/route/override` — شارة التصحيح بنقرة (تُسجَّل لتحسين القواعد).
- `GET /api/studio/route/telemetry` — قياسات المالك فقط (عزل مستأجرين).

### معايير القبول (جناح `smartRouterSuite.test.js` — 15/15)
- نظافة الكود: صفر عربية في ملفات الموجّه الثمانية (T12)؛ العربية في `i18n/routerLexicon.js` و`fixtures/routerFixtures.cjs` فقط.
- Fast-Path: قناع/نقرة/أمر قاطع <10ms مع صفر استدعاءات LLM (T2–T4).
- «ابني لي واجهة متجر قهوة الأصالة في سحراء» ⇒ `protected_brand_text === "قهوة الأصالة"` حرفياً + «صحراء» مصححة تصل `desert` في `enhanced_prompt` (T5).
- «أضف خيمة على اليمين» بعد صورة ⇒ `image_edit`؛ «اجعل الألوان أغمق» بعد واجهة ⇒ `ui_edit` — بصفر نموذج (T6).
- ثقة 0.6 ⇒ خياران سريعان، صفر استهلاك، `ambiguous=1` في القياس (T7).
- JSON مكسور من المحلي ⇒ محاولة واحدة ⇒ تحول صامت لـ cloud_flash + صف قياس كامل `fallback_used=1` (T8).

---

## ثانياً: وضع الصور — المرحلة 1 (Image Mode)

### ما نُفذ من الطبقات المخصصة للمرحلة 1

| الطبقة | ما نُفذ | الملفات |
|---|---|---|
| 1. العرض والبدائل | توليد 2–4 بدائل بمجموعة `generation_group` واحدة، حصة صادقة لكل بديل، مكوّنات اللوحة (Zoom/Pan/Fit، شبكة، Safe-Zone، شريط بدائل مع Pin، تبديل تكيفي بلا إعادة تحميل) | `imageModeService.js` + `src/studio/ImageStudioPanel.tsx` |
| 2. التوجيه والمرجعية | رفع صورة مرجعية (product/style) بفحص Magic Bytes + SHA-256، تمريرها multimodal لـ Gemini، قفل البذرة `style_seed` في الحمولة، شريط مقاسات، حقل النص المحمي | `referenceStore.js` + `imageProviders.js` + `ControlsBar` |
| 4. المعالجة المحلية | نسخة WebP محلية عبر ffmpeg ($0) مع فحص RIFF/WEBP، تُقدَّم عبر `?format=webp` مع بقاء PNG الأصل | `postProcess.js` |
| 5. الكاش والقياس | بصمة SHA-256 (برومبت+وضع+معدّلات+بذرة+مقاس+بصمة المرجع) — التكرار يُرجع الأصل نفسه `cache_hit=1` بصفر استدعاء API وصفر حصة؛ أحداث مراحل حية SSE (`enhance→generate→ocr→postprocess→ready`) مع إعادة تشغيل التاريخ للمتأخرين | `studioService.js` + `pipelineEvents.js` + ترحيل 036 |

### جناح `imageModeSuite.test.js` — 10/10
مرجعية بفحص بايتي وعزل مستأجرين (M1)، انعكاس seed/protected في الحمولة والصف (M2)، 3 بدائل بمجموعة واحدة و3 وحدات حصة (M3)، بذرة مقفلة متفرعة `seed:0..N-1` (M3b)، كاش بصمة بصفر صرف إضافي (M4)، WebP حقيقي بـ ffmpeg (M5)، ترتيب مراحل فعلي (M6)، سطح HTTP كامل + SSE (M7)، جدار حصة 429 منتصف الدفعة بصدق (M8)، بوابة اللغة (M9).

---

## الحدود الصادقة (غير المتحقق منها)
1. **توليد Gemini الحقيقي** لم يُختبر (لا مفتاح في بيئة الاختبار) — العقد والمحوّل جاهزان والمسار مختبَر بمزوّد وهمي حتمي.
2. **style_seed مرساة برومبت** لا بذرة API (Gemini لا يقبل معامل seed).
3. **مكوّنات React فُحصت بناءً (esbuild) ولم تُركّب** — التركيب واختبار «صفر إعادة تحميل» و«صفر صور مكسورة» في المتصفح موعده المرحلة 3 مع صفحة الاستوديو.
4. **مؤشر قبل/بعد (Split Slider)** مؤجل للمرحلة 2 حسب جدول توزيع الطبقات.
5. **SSE في الذاكرة** — عقدة واحدة؛ عند التوسع الأفقي يُستبدل بـ Redis خلف نفس الواجهة.
6. **WebP يتطلب ffmpeg على المضيف** (موجود في حاوية الفيديو)؛ غيابه ⇒ `webp_url: null` بصدق دون كسر.

## التراجع
الموجّه 15/15 + Image Mode 10/10 + المرحلة 1 للاستوديو 25/25 + الأوضاع 14/14 + أجنحة المنصة (ترحيلات من الصفر، وسائط/بطاقات 16، تحسين مستمر 13، إصلاح ذاتي 10، فحص أمني 10، فهرس 12، ميزات ذكاء 11) — كلها خضراء. بوابتان جديدتان (8g/8h) في `scripts/verify-build.mjs`.
