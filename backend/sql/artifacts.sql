-- Artifact metadata tables. Run in the Supabase SQL editor.
-- File bytes live in Storage bucket `SUPABASE_ARTIFACTS_BUCKET` (default: artifacts).

create table if not exists public.artifact_files (
  id text primary key,
  user_id text not null,
  thread_id text not null,
  phase text,
  name text not null,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_id, name)
);

create table if not exists public.artifact_versions (
  id text primary key,
  file_id text not null references public.artifact_files (id) on delete cascade,
  version integer not null,
  size integer not null,
  mime_type text not null,
  storage_path text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (file_id, version),
  constraint artifact_versions_source_check
    check (source in ('phase', 'write_files', 'edit'))
);

create index if not exists artifact_files_user_id_idx on public.artifact_files (user_id);
create index if not exists artifact_files_user_thread_idx on public.artifact_files (user_id, thread_id);
create index if not exists artifact_versions_file_id_idx on public.artifact_versions (file_id);

alter table public.artifact_files enable row level security;
alter table public.artifact_versions enable row level security;

-- Backend uses the service role key, which bypasses RLS.
-- These policies apply if the anon/authenticated keys are used.
drop policy if exists "artifact_files_owner" on public.artifact_files;
create policy "artifact_files_owner" on public.artifact_files
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists "artifact_versions_owner" on public.artifact_versions;
create policy "artifact_versions_owner" on public.artifact_versions
  for all
  using (
    exists (
      select 1 from public.artifact_files f
      where f.id = file_id and f.user_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.artifact_files f
      where f.id = file_id and f.user_id = auth.uid()::text
    )
  );
