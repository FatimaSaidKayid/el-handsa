-- =====================================================================
-- EL HANDSA — إعداد قاعدة البيانات (شغّله كاملاً في Supabase > SQL Editor)
-- آمن للتشغيل أكثر من مرة.
-- =====================================================================

-- 1) إيميل المعلم المعتمد (الوحيد الذي يفتح شاشة المعلم)
create table if not exists public.teacher_allowlist (
  email text primary key check (email = lower(email))
);
alter table public.teacher_allowlist enable row level security;
revoke all on public.teacher_allowlist from anon, authenticated;
insert into public.teacher_allowlist(email)
values ('fatimasaidkayed@gmail.com')
on conflict (email) do nothing;

-- 2) الملفات الشخصية: الاسم + رقم الهاتف + الصف
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'student' check (role in ('student','teacher')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists grade smallint check (grade between 1 and 3);
create unique index if not exists profiles_phone_unique on public.profiles(phone) where phone is not null;
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  account_role text := 'student';
  meta_grade   smallint := null;
begin
  if exists (select 1 from public.teacher_allowlist where email = lower(new.email)) then
    account_role := 'teacher';
  end if;

  if (new.raw_user_meta_data->>'grade') in ('1','2','3') then
    meta_grade := (new.raw_user_meta_data->>'grade')::smallint;
  end if;

  insert into public.profiles(id,email,role,full_name,phone,grade)
  values(
    new.id, lower(new.email), account_role,
    nullif(left(trim(new.raw_user_meta_data->>'full_name'),80),''),
    nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''),'[^0-9]','','g'),''),
    case when account_role = 'student' then meta_grade else null end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- حسابات موجودة قبل التحديث
insert into public.profiles(id,email,role)
select u.id,lower(u.email),
  case when exists(select 1 from public.teacher_allowlist a where a.email=lower(u.email))
       then 'teacher' else 'student' end
from auth.users u
on conflict (id) do update
  set email = excluded.email, role = excluded.role;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
for select to authenticated using (id = auth.uid());

-- 3) الدروس
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  grade smallint not null check (grade between 1 and 3),
  description text default '',
  storage_path text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.lessons enable row level security;

-- الطالب يرى دروس صفه فقط، والمعلم يرى الكل
drop policy if exists "Authenticated users can view lessons" on public.lessons;
drop policy if exists "Students see own grade, teachers see all" on public.lessons;
create policy "Students see own grade, teachers see all" on public.lessons
for select to authenticated using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'teacher' or p.grade = lessons.grade)
  )
);

drop policy if exists "Teachers can add lessons" on public.lessons;
create policy "Teachers can add lessons" on public.lessons
for insert to authenticated
with check (created_by = auth.uid() and exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'
));

drop policy if exists "Teachers can delete lessons" on public.lessons;
create policy "Teachers can delete lessons" on public.lessons
for delete to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher')
);

-- 4) تخزين الفيديوهات
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('lesson-videos','lesson-videos',true,524288000,
  array['video/mp4','video/webm','video/quicktime','video/x-m4v','video/3gpp'])
on conflict (id) do update set public=true,file_size_limit=524288000;

drop policy if exists "Teachers upload lesson videos" on storage.objects;
create policy "Teachers upload lesson videos" on storage.objects
for insert to authenticated with check (
  bucket_id = 'lesson-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher')
);

drop policy if exists "Teachers update lesson videos" on storage.objects;
create policy "Teachers update lesson videos" on storage.objects
for update to authenticated using (
  bucket_id='lesson-videos'
  and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher')
) with check (bucket_id='lesson-videos');

drop policy if exists "Teachers delete lesson videos" on storage.objects;
create policy "Teachers delete lesson videos" on storage.objects
for delete to authenticated using (
  bucket_id='lesson-videos'
  and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role='teacher')
);
