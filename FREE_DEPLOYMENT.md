# نشر AmiGo AI مجاناً على Render

هذا هو المسار الأبسط لإطلاق نسخة MVP عامة من AmiGo AI بلا دفع شهري:

- **Render Free Web Service** يشغّل الموقع والـAPI ومعالج الرسائل داخل حاوية واحدة.
- **Render Free Key Value** يشغّل BullMQ والـrate limiting.
- **Neon Free Postgres** يحفظ المتاجر والمنتجات والمحادثات والطلبيات بصورة دائمة.
- **Groq Free API** يشغّل النموذج `llama-3.3-70b-versatile`.

> المجاني مناسب للتجربة وأول المستخدمين، وليس خدمة إنتاج ذات ضمان تشغيل. Render يوقف الخدمة بعد 15 دقيقة من الخمول، وأول فتح بعدها قد يستغرق قرابة دقيقة.

## قبل البدء: ألغِ المفتاح القديم

مفتاح Groq الذي ظهر في المحادثة أصبح مكشوفاً. احذفه من لوحة Groq وأنشئ مفتاحاً جديداً. لا تكتبه داخل الكود أو GitHub؛ ستضعه في خانة سرية داخل Render فقط.

## 1. أنشئ قاعدة Neon المجانية

1. افتح [Neon](https://console.neon.tech/) وسجّل بحساب GitHub.
2. اختر **Create project**، ويفضل منطقة أوروبية قريبة مثل Frankfurt إن ظهرت.
3. بعد إنشاء المشروع اضغط **Connect**.
4. اختر الاتصال المباشر **Direct connection** وليس pooled connection.
5. انسخ الرابط الكامل الذي يبدأ بـ`postgresql://` واحتفظ به مؤقتاً. هذا هو `DATABASE_URL`.

لا تنشر هذا الرابط ولا تضعه في مستودع GitHub. AmiGo ينشئ تلقائياً دوراً محدوداً باسم `amigo_app` ويستعمله لجميع استعلامات المتاجر، بينما يبقى رابط Neon الإداري للترحيلات والمهام النظامية فقط.

## 2. أنشئ مفتاح التشفير

أنشئ مفتاحاً عشوائياً بصيغة Base64 يفك إلى 32 بايت بالضبط:

```bash
openssl rand -base64 32
```

احتفظ بالقيمة مؤقتاً. هذه هي `CREDENTIAL_ENCRYPTION_KEY`. لا تغيّرها بعد ربط القنوات أو تخزين الرموز، لأن تغييرها يجعل فك البيانات القديمة غير ممكن من دون عملية تدوير مخصّصة.

## 3. انشر من GitHub إلى Render

1. افتح [Render Dashboard](https://dashboard.render.com/) وسجّل بحساب GitHub.
2. اسمح لتطبيق Render بالوصول إلى المستودع `amigo-ai`.
3. اختر **New → Blueprint** ثم اختر مستودع `amigo-ai`.
4. سيقرأ Render ملف `render.yaml` تلقائياً ويطلب القيم التالية:

   | المتغيّر                    | ما تضعه                                        |
   | --------------------------- | ---------------------------------------------- |
   | `DATABASE_URL`              | رابط الاتصال المباشر الذي نسخته من Neon        |
   | `GROQ_API_KEY`              | مفتاح Groq الجديد، وليس المفتاح المنشور سابقاً |
   | `CREDENTIAL_ENCRYPTION_KEY` | ناتج الأمر `openssl rand -base64 32`            |

5. اضغط **Apply** وانتظر اكتمال البناء.
6. افتح خدمة `amigo-ai` ثم اضغط الرابط الذي ينتهي بـ`.onrender.com`.
7. اختر **افتح متجرك** وأنشئ أول حساب.

Render يولّد تلقائياً كلمة سر دور قاعدة البيانات المحدود ومفاتيح JWT وOAuth وWebhook verify token. مفتاح تشفير الاعتمادات لا يُولّد تلقائياً لأن التطبيق يحتاج صيغة دقيقة بطول 32 بايت.

## 4. فعّل Meta عندما يصبح الموقع جاهزاً

يمكنك فتح الموقع وإدارة الكتالوج قبل تجهيز Meta. عندما تنشئ Meta Business App:

1. في Render افتح `amigo-ai → Environment`.
2. أضف:

   ```text
   META_APP_ID=معرف تطبيق Meta
   META_APP_SECRET=سر تطبيق Meta
   ```

3. احفظ التغييرات وانتظر إعادة النشر.
4. داخل Meta Developer Dashboard استعمل رابط Render الحقيقي مكان `YOUR-SITE`:

   ```text
   OAuth redirect:
   https://YOUR-SITE.onrender.com/api/integrations/meta/callback

   Facebook + Instagram webhook:
   https://YOUR-SITE.onrender.com/api/webhooks/meta

   WhatsApp Cloud webhook:
   https://YOUR-SITE.onrender.com/api/webhooks/whatsapp
   ```

5. انسخ قيمة `META_VERIFY_TOKEN` من Environment في Render إلى خانة Verify Token في Meta.
6. من لوحة AmiGo افتح **قنوات التواصل** واضغط **Meta OAuth**.

للإطلاق أمام متاجر ليست ضمن حساب المطور، ستحتاج App Review والصلاحيات المناسبة وBusiness Verification وسياسة خصوصية وData Deletion URL حسب متطلبات Meta.

## WhatsApp على الخطة المجانية

استعمل **WhatsApp Cloud API**. خيار QR/Baileys معطّل في نشر Render المجاني لأن الخدمة تنام ويضيع اتصال WhatsApp Web المستمر. الكود موجود ويمكن تفعيله لاحقاً على خادم دائم، لكنه غير رسمي ولا يُنصح به لحمل تجاري حساس.

## حدود الخطة المجانية

- Render يوقف Web Service بعد 15 دقيقة بلا زيارات، ثم يحتاج قرابة دقيقة ليستيقظ.
- Render يمنح 750 ساعة تشغيل مجانية شهرياً لمساحة العمل.
- Render Key Value المجاني يعمل من الذاكرة وقد يفقد بيانات الطابور عند إعادة التشغيل. أحداث Webhook محفوظة أولاً في PostgreSQL، والعامل يسترجع الأحداث غير المكتملة تلقائياً.
- قاعدة Neon هي مصدر البيانات الدائم؛ لا تستعمل Render Free Postgres لأنه ينتهي بعد 30 يوماً.
- Groq وNeon لهما حدود استعمال مجانية. عند تجاوزها يجب الانتظار أو الترقية.
- اسم `onrender.com` وHTTPS مجانيان. اسم نطاق خاص مثل `.com` ليس مجانياً عادةً.

المراجع الرسمية: [Render Free](https://render.com/docs/free)، [Render Blueprints](https://render.com/docs/infrastructure-as-code)، [Neon Free](https://neon.com/pricing)، [Groq Quickstart](https://console.groq.com/docs/quickstart).

## فحص التشغيل

بعد النشر افتح:

```text
https://YOUR-SITE.onrender.com/health/live
https://YOUR-SITE.onrender.com/health/ready
```

الأول يجب أن يعيد `{"status":"ok"}`. الثاني يعيد `{"status":"ready"}` عندما تكون Neon وRender Key Value متصلتين.

إذا فشل النشر افتح **Logs** في خدمة `amigo-ai`. أكثر الأخطاء شيوعاً هي رابط Neon ناقص، مفتاح Groq ملغى، مفتاح تشفير غير صالح، أو عدم منح Render حق الوصول إلى المستودع.
