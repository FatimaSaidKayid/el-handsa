window.EL_HANDSA_CONFIG = {
  SUPABASE_URL: "https://vhajuhcrfyqlnlemvlhb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_906whWAeftDYGveyAjwSPg_yUS2Rwd6",

  // إيميل المعلم الوحيد الذي يفتح شاشة المعلم (مخصص من الكود).
  // لا بد أن يكون نفس الإيميل في جدول teacher_allowlist داخل supabase-setup.sql
  TEACHER_EMAILS: ["fatimasaidkayed@gmail.com"],

  // رقم واتساب الدعم بالصيغة الدولية بدون + أو مسافات (مثال لمصر: 201012345678)
  WHATSAPP_NUMBER: "20 10 09616162⁩",
  WHATSAPP_MESSAGE: "مرحباً، أحتاج مساعدة في منصة El Handsa",

  // نطاق داخلي يُستخدم لتحويل رقم هاتف الطالب إلى هوية دخول (لا يُرسل له أي بريد)
  STUDENT_EMAIL_DOMAIN: "students.elhandsa.app"
};
