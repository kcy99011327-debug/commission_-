-- 커미션 작업실: Supabase 초기 설정 (SQL Editor에 통째로 붙여 넣고 Run)

-- 1) 데이터 표: 커미션·템플릿·설정을 한 표에 저장
create table if not exists public.docs (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner, col, id)
);
alter table public.docs enable row level security;
drop policy if exists "own docs" on public.docs;
create policy "own docs" on public.docs for all to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

-- 2) 실시간 연동 (폰 <-> PC)
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3) 이미지 저장소: 주소를 알아야만 열리는 공개 버킷, 올리기·지우기는 로그인한 본인만
insert into storage.buckets (id, name, public, file_size_limit)
values ('images', 'images', true, 52428800)
on conflict (id) do update set public = true;
drop policy if exists "images insert" on storage.objects;
drop policy if exists "images update" on storage.objects;
drop policy if exists "images delete" on storage.objects;
drop policy if exists "images select" on storage.objects;
create policy "images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images');
create policy "images select" on storage.objects for select to authenticated
  using (bucket_id = 'images' and owner_id = (select auth.uid())::text);
create policy "images update" on storage.objects for update to authenticated
  using (bucket_id = 'images' and owner_id = (select auth.uid())::text);
create policy "images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and owner_id = (select auth.uid())::text);
