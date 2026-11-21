(() => {
  const cfg = window.EL_HANDSA_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const TEACHERS = (cfg.TEACHER_EMAILS || []).map(e => e.trim().toLowerCase());
  const DOMAIN = cfg.STUDENT_EMAIL_DOMAIN || "students.elhandsa.app";
  const $ = (id) => document.getElementById(id);
  const gradeNames = {1:"الأول الثانوي",2:"الثاني الثانوي",3:"الثالث الثانوي"};
  let supabase = null, currentUser = null, selectedGrade = "all", lessons = [], authMode = "login";

  document.querySelectorAll(".year").forEach(e => e.textContent = new Date().getFullYear());

  /* ---------- theme ---------- */
  function applyTheme(t){
    if(t==="dark")document.documentElement.setAttribute("data-theme","dark");else document.documentElement.removeAttribute("data-theme");
    const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="dark"?"#07130f":"#0f8a5f";
  }
  applyTheme(document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light");
  document.querySelectorAll("[data-theme-toggle]").forEach(b=>b.addEventListener("click",()=>{
    const next=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";
    applyTheme(next);try{localStorage.setItem("elh-theme",next);}catch(e){}
  }));

  /* ---------- WhatsApp support ---------- */
  (function(){
    const num=String(cfg.WHATSAPP_NUMBER||"").replace(/\D/g,""), a=document.getElementById("wa-float");
    if(!a)return;
    const text=encodeURIComponent(cfg.WHATSAPP_MESSAGE||"مرحباً، أحتاج مساعدة في منصة El Handsa");
    if(num)a.href=`https://wa.me/${num}?text=${text}`;
    else a.addEventListener("click",e=>{e.preventDefault();toast("أضف رقم واتساب الدعم في ملف config.js");});
  })();

  /* ---------- helpers ---------- */
  const escapeHtml = (s="") => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function toast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),3000);}
  function showMessage(msg, ok=false){const el=$("auth-message");el.textContent=msg||"";el.classList.toggle("success",ok);}
  // يحوّل الأرقام العربية إلى إنجليزية ويحذف أي رموز
  function normalizePhone(v){
    return String(v||"").replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/\D/g,"");
  }
  const validPhone = p => /^01[0125]\d{8}$/.test(p);
  const phoneToEmail = p => `${p}@${DOMAIN}`;
  function setBusy(btn, busy, label){btn.disabled=busy;if(busy){btn.dataset.l=btn.textContent;btn.textContent=label;}else btn.textContent=btn.dataset.l||btn.textContent;}

  /* ---------- navigation (site / dashboard) ---------- */
  function showSite(){ $("dashboard-screen").classList.add("hidden"); $("site").classList.remove("hidden"); window.scrollTo(0,0); refreshNavButtons(); }
  function showDashboard(){ $("site").classList.add("hidden"); $("dashboard-screen").classList.remove("hidden"); window.scrollTo(0,0); }
  function refreshNavButtons(){
    const logged = !!currentUser;
    document.querySelectorAll('.nav-actions [data-open-auth="login"]').forEach(b=>b.textContent=logged?"لوحتي":"تسجيل الدخول");
    document.querySelectorAll('.nav-actions [data-open-auth="signup"]').forEach(b=>b.classList.toggle("hidden",logged));
  }
  window.addEventListener("scroll",()=>$("nav").classList.toggle("scrolled",scrollY>8),{passive:true});
  $("burger").addEventListener("click",()=>$("nav-links").classList.toggle("open"));
  $("nav-links").addEventListener("click",e=>{if(e.target.tagName==="A")$("nav-links").classList.remove("open");});
  $("home-btn").addEventListener("click",showSite);
  $("side-toggle").addEventListener("click",()=>$("sidebar").classList.toggle("open"));

  /* ---------- auth modal ---------- */
  function setMode(mode){
    authMode=mode;
    $("login-form").classList.toggle("hidden",mode!=="login");
    $("signup-form").classList.toggle("hidden",mode!=="signup");
    $("teacher-form").classList.toggle("hidden",mode!=="teacher");
    $("auth-tabs").classList.toggle("hidden",mode==="teacher");
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===mode));
    $("toggle-teacher").textContent=mode==="teacher"?"← الرجوع لدخول الطالب":"🔒 دخول الهندسة";
    $("auth-title").textContent=mode==="teacher"?"دخول الهندسة":"مرحباً بك في El Handsa";
    $("auth-sub").textContent=mode==="teacher"?"هذه الشاشة الهندسة المعتمد فقط":mode==="signup"?"أنشئ حسابك وابدأ المذاكرة":"سجّل دخولك لمتابعة دروسك";
    showMessage("");
  }
  function openAuth(mode){
    if(currentUser && mode!=="teacher"){showDashboard();return;}
    setMode(mode||"login"); $("auth-modal").classList.remove("hidden");
    setTimeout(()=>{const f=document.querySelector("#auth-modal form:not(.hidden) input");f&&f.focus();},50);
  }
  function closeAuth(){$("auth-modal").classList.add("hidden");}
  document.addEventListener("click",e=>{
    const o=e.target.closest("[data-open-auth]"); if(o){openAuth(o.dataset.openAuth);}
    if(e.target.closest("[data-close-auth]")) closeAuth();
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeAuth();closeModal();}});
  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>setMode(t.dataset.tab)));
  $("toggle-teacher").addEventListener("click",()=>setMode(authMode==="teacher"?"login":"teacher"));
  document.querySelectorAll(".pw-toggle").forEach(b=>b.addEventListener("click",()=>{const i=b.parentElement.querySelector("input");i.type=i.type==="password"?"text":"password";}));

  /* ---------- Supabase init ---------- */
  if (configured && window.supabase) {
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    supabase.auth.getSession().then(({data}) => { if (data.session) acceptSession(data.session, null, true); });
  }
  const needSupabase = () => { if(!supabase){showMessage("المنصة غير متصلة بقاعدة البيانات حالياً. تأكد من ملف config.js.");return true;} return false; };

  async function getProfile(userId){
    const {data,error}=await supabase.from("profiles").select("role,full_name,phone,grade").eq("id",userId).single();
    return error?null:data;
  }

  /* ---------- sign up (اسم + هاتف + صف + كلمة مرور) ---------- */
  $("signup-form").addEventListener("submit", async e => {
    e.preventDefault(); if(needSupabase())return;
    const name=$("su-name").value.trim().replace(/\s+/g," "), phone=normalizePhone($("su-phone").value),
          grade=$("su-grade").value, password=$("su-password").value;
    if(name.length<3) return showMessage("اكتب اسمك بالكامل.");
    if(!validPhone(phone)) return showMessage("رقم الهاتف غير صحيح. مثال: 01012345678");
    if(!grade) return showMessage("اختر صفك الدراسي.");
    if(password.length<6) return showMessage("كلمة المرور يجب أن تكون 6 أحرف أو أرقام على الأقل.");
    const btn=$("signup-submit"); setBusy(btn,true,"جارٍ إنشاء الحساب..."); showMessage("");
    const {data,error}=await supabase.auth.signUp({email:phoneToEmail(phone),password,options:{data:{full_name:name,phone,grade}}});
    setBusy(btn,false);
    if(error){
      showMessage(/registered|exists/i.test(error.message)?"رقم الهاتف هذا مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.":"تعذر إنشاء الحساب: "+error.message);return;
    }
    if(data.user && data.user.identities && data.user.identities.length===0){showMessage("رقم الهاتف هذا مسجّل بالفعل. سجّل الدخول بدلاً من ذلك.");return;}
    if(!data.session){showMessage("تم إنشاء الحساب، لكن تأكيد البريد مفعّل في Supabase. أوقفه من إعدادات Authentication ثم سجّل الدخول.",true);return;}
    acceptSession(data.session);
  });

  /* ---------- student login (هاتف + كلمة مرور) ---------- */
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); if(needSupabase())return;
    const phone=normalizePhone($("login-phone").value), password=$("login-password").value;
    if(!validPhone(phone)) return showMessage("رقم الهاتف غير صحيح.");
    if(!password) return showMessage("أدخل كلمة المرور.");
    const btn=$("login-submit"); setBusy(btn,true,"جارٍ التحقق..."); showMessage("");
    const {data,error}=await supabase.auth.signInWithPassword({email:phoneToEmail(phone),password});
    setBusy(btn,false);
    if(error) return showMessage("رقم الهاتف أو كلمة المرور غير صحيحة.");
    const profile=await getProfile(data.user.id);
    if(!profile){await supabase.auth.signOut();return showMessage("لم يتم إعداد ملف الحساب. تواصل مع إدارة المنصة.");}
    acceptSession(data.session,profile);
  });

  /* ---------- teacher login (الإيميل المعتمد فقط) ---------- */
  $("teacher-form").addEventListener("submit", async e => {
    e.preventDefault(); if(needSupabase())return;
    const email=$("t-email").value.trim().toLowerCase(), password=$("t-password").value;
    if(!TEACHERS.includes(email)) return showMessage("هذا البريد غير معتمد كحساب الهندسة.");
    const btn=$("teacher-submit"); setBusy(btn,true,"جارٍ التحقق..."); showMessage("");
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    setBusy(btn,false);
    if(error) return showMessage("البريد أو كلمة المرور غير صحيحة.");
    const profile=await getProfile(data.user.id);
    if(!profile||profile.role!=="teacher"){await supabase.auth.signOut();return showMessage("هذا البريد غير معتمد كحساب الهندسة.");}
    acceptSession(data.session,profile);
  });

  /* ---------- session ---------- */
  async function acceptSession(session, knownProfile, silent){
    const profile=knownProfile||await getProfile(session.user.id);
    if(!profile){await supabase.auth.signOut();return;}
    const isTeacher=profile.role==="teacher" && TEACHERS.includes((session.user.email||"").toLowerCase());
    if(profile.role==="teacher" && !isTeacher){await supabase.auth.signOut();showMessage("هذا البريد غير معتمد كحساب الهندسة.");return;}
    currentUser={id:session.user.id,email:session.user.email,role:isTeacher?"teacher":"student",name:profile.full_name,phone:profile.phone,grade:profile.grade};
    closeAuth();
    const first=(profile.full_name||"").split(" ")[0];
    $("side-user-name").textContent=isTeacher?"الهندسة":(profile.full_name||profile.phone||"طالب");
    $("side-user-role").textContent=isTeacher?"":"طالب";
    $("avatar").textContent=isTeacher?"✏️":(first[0]||"∑");
    $("welcome-title").textContent=isTeacher?"مرحباً بك في لوحة الهندسة":`أهلاً ${first||"بك"} 👋`;
    $("grade-badge").textContent=isTeacher?"":(gradeNames[profile.grade]?`الصف ${gradeNames[profile.grade]}`:"");
    $("lib-title").textContent=isTeacher?"كل الدروس":"دروس صفك";
    $("banner-sub").textContent=isTeacher?"أدِر دروس جميع الصفوف وأضف فيديوهات جديدة.":"كل شروحاتك مرتبة في مكان واحد.";
    document.querySelectorAll(".teacher-only").forEach(x=>x.classList.toggle("hidden",!isTeacher));
    selectedGrade="all";
    activateView("library");
    showDashboard(); refreshNavButtons();
    await loadLessons();
  }
  $("logout-btn").addEventListener("click",async()=>{
    if(supabase)await supabase.auth.signOut();
    currentUser=null;lessons=[];$("sidebar").classList.remove("open");
    ["login-password","su-password","t-password"].forEach(i=>$(i).value="");
    showSite();
  });

  /* ---------- views ---------- */
  function activateView(view){
    const upload=view==="upload";
    $("library-view").classList.toggle("hidden",upload);$("upload-view").classList.toggle("hidden",!upload);
    document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("breadcrumb").textContent=upload?"رفع فيديو جديد":"المكتبة التعليمية";
    $("sidebar").classList.remove("open");
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>activateView(b.dataset.view)));

  /* ---------- lessons ---------- */
  async function loadLessons(){
    let q=supabase.from("lessons").select("*").order("created_at",{ascending:false});
    // طبقة حماية إضافية: الطالب يطلب دروس صفه فقط (وقاعدة البيانات تفرض ذلك أيضاً)
    if(currentUser.role==="student"){
      if(!currentUser.grade){renderEmpty("لم يتم تحديد صفك الدراسي","تواصل مع إدارة المنصة لتحديث بيانات حسابك.");return;}
      q=q.eq("grade",currentUser.grade);
    }
    const {data,error}=await q;
    if(error){renderEmpty("حدث خطأ أثناء تحميل الدروس.");return;}
    lessons=data||[];renderLessons();
  }
  function renderEmpty(title,sub="ستظهر الدروس هنا بعد نشرها."){
    $("video-grid").innerHTML=`<div class="empty-state"><div class="empty-icon">∑</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p></div>`;
  }
  function renderLessons(){
    const term=$("search-input").value.trim().toLowerCase(), teacher=currentUser?.role==="teacher";
    const shown=lessons.filter(x=>(!teacher||selectedGrade==="all"||String(x.grade)===selectedGrade)&&(`${x.title} ${x.description||""}`).toLowerCase().includes(term));
    $("video-count").textContent=`${shown.length} فيديو`;
    if(!shown.length){renderEmpty(lessons.length?"لا توجد دروس مطابقة للبحث.":"لا توجد دروس حتى الآن");return;}
    $("video-grid").innerHTML=shown.map(x=>`<article class="video-card"><div class="video-thumb"><button class="play-button" data-play="${x.id}" aria-label="مشاهدة الدرس">▶</button></div><div class="video-card-body"><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description||"شرح من منصة El Handsa التعليمية")}</p><div class="video-meta"><span>${gradeNames[x.grade]||""}</span>${teacher?`<button class="delete-video" data-delete="${x.id}">حذف الدرس</button>`:""}</div></div></article>`).join("");
  }
  $("video-grid").addEventListener("click",e=>{
    const p=e.target.closest("[data-play]"), d=e.target.closest("[data-delete]");
    if(p)openLesson(lessons.find(x=>x.id===p.dataset.play));
    if(d)deleteLesson(d.dataset.delete);
  });
  document.querySelectorAll(".filter").forEach(b=>b.addEventListener("click",()=>{
    selectedGrade=b.dataset.grade;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));renderLessons();
  }));
  $("search-input").addEventListener("input",renderLessons);

  function openLesson(lesson){
    if(!lesson)return;
    const {data}=supabase.storage.from("lesson-videos").getPublicUrl(lesson.storage_path);
    $("lesson-player").src=data.publicUrl;$("modal-title").textContent=lesson.title;
    $("modal-description").textContent=lesson.description||"";
    $("modal-grade").textContent=gradeNames[lesson.grade]||"";
    $("video-modal").classList.remove("hidden");$("lesson-player").play().catch(()=>{});
  }
  function closeModal(){const p=$("lesson-player");p.pause();p.removeAttribute("src");p.load();$("video-modal").classList.add("hidden");}
  $("close-modal").addEventListener("click",closeModal);$("modal-backdrop").addEventListener("click",closeModal);

  /* ---------- upload (المعلم فقط) ---------- */
  $("video-file").addEventListener("change",()=>{$("file-name").textContent=$("video-file").files[0]?.name||"لم يتم اختيار ملف بعد";});
  $("upload-form").addEventListener("submit",async e=>{
    e.preventDefault();
    if(currentUser?.role!=="teacher"){toast("هذه الخاصية متاحة للهندسة فقط.");return;}
    const file=$("video-file").files[0], title=$("lesson-title").value.trim(), grade=$("lesson-grade").value;
    if(!file||!title||!grade)return;
    if(!file.type.startsWith("video/")){toast("اختر ملف فيديو صالحاً.");return;}
    if(file.size>500*1024*1024){toast("حجم الملف أكبر من 500 ميجابايت.");return;}
    const ext=(file.name.split(".").pop()||"mp4").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
    const path=`${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    $("upload-submit").disabled=true;$("upload-submit").textContent="جارٍ الرفع...";
    $("progress-track").classList.remove("hidden");$("progress-bar").style.width="15%";
    const {error:upErr}=await supabase.storage.from("lesson-videos").upload(path,file,{contentType:file.type,upsert:false});
    if(upErr){toast("فشل رفع الفيديو: "+upErr.message);resetUpload();return;}
    $("progress-bar").style.width="75%";
    const {error:dbErr}=await supabase.from("lessons").insert({title,grade:Number(grade),description:$("lesson-description").value.trim(),storage_path:path,created_by:currentUser.id});
    if(dbErr){await supabase.storage.from("lesson-videos").remove([path]);toast("تعذر حفظ بيانات الدرس.");resetUpload();return;}
    $("progress-bar").style.width="100%";$("upload-form").reset();$("file-name").textContent="لم يتم اختيار ملف بعد";
    toast("تم نشر الدرس بنجاح.");await loadLessons();resetUpload();activateView("library");
  });
  function resetUpload(){$("upload-submit").disabled=false;$("upload-submit").textContent="نشر الدرس ↑";$("progress-track").classList.add("hidden");$("progress-bar").style.width="0";}
  async function deleteLesson(id){
    if(currentUser?.role!=="teacher"||!confirm("هل أنت متأكد من حذف هذا الدرس؟"))return;
    const lesson=lessons.find(x=>x.id===id);if(!lesson)return;
    const {error}=await supabase.from("lessons").delete().eq("id",id);
    if(error){toast("تعذر حذف الدرس.");return;}
    await supabase.storage.from("lesson-videos").remove([lesson.storage_path]);
    toast("تم حذف الدرس.");await loadLessons();
  }
})();
