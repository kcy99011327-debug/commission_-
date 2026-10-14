-- =========================================================
-- 커미션 작업실 · 서버 설정 스크립트
-- Supabase → SQL Editor 에 전부 붙여 넣고 Run 을 누르세요.
-- 여러 번 실행해도 괜찮아요.
-- =========================================================

-- 1) 자료 표
create table if not exists public.cm_docs (
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col        text not null,
  id         text not null,
  data       jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (owner, col, id)
);
create index if not exists cm_docs_sync_idx on public.cm_docs (owner, synced_at);

-- 서버가 받은 시각을 기록 (기기끼리 새 변경을 찾을 때 씀)
create or replace function public.cm_touch() returns trigger
language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists cm_docs_touch on public.cm_docs;
create trigger cm_docs_touch before insert or update on public.cm_docs
  for each row execute function public.cm_touch();

-- 2) 내 자료만 보고 고칠 수 있게
alter table public.cm_docs enable row level security;
drop policy if exists "cm own rows" on public.cm_docs;
create policy "cm own rows" on public.cm_docs
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- 3) 폰·컴퓨터 실시간 맞춤
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cm_docs'
  ) then
    alter publication supabase_realtime add table public.cm_docs;
  end if;
end $$;

-- 4) 이미지 보관함 (비공개)
insert into storage.buckets (id, name, public)
values ('cm-images', 'cm-images', false)
on conflict (id) do nothing;

drop policy if exists "cm images read"   on storage.objects;
drop policy if exists "cm images insert" on storage.objects;
drop policy if exists "cm images update" on storage.objects;
drop policy if exists "cm images delete" on storage.objects;
create policy "cm images read" on storage.objects for select to authenticated
  using (bucket_id = 'cm-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cm images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'cm-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cm images update" on storage.objects for update to authenticated
  using (bucket_id = 'cm-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "cm images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cm-images' and (storage.foldername(name))[1] = auth.uid()::text);
