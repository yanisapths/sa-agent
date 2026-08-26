-- Vault metadata tables. Run in the Supabase SQL editor.
-- File bytes live in Storage bucket `SUPABASE_VAULT_BUCKET` (default: vault).

create table if not exists public.vault_folders (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.vault_files (
  id text primary key,
  folder_id text not null references public.vault_folders (id) on delete cascade,
  user_id text not null,
  name text not null,
  size integer not null,
  mime_type text not null,
  storage_path text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists vault_folders_user_id_idx on public.vault_folders (user_id);
create index if not exists vault_files_user_id_idx on public.vault_files (user_id);
create index if not exists vault_files_folder_id_idx on public.vault_files (folder_id);

alter table public.vault_folders enable row level security;
alter table public.vault_files enable row level security;

-- Backend uses the service role key, which bypasses RLS.
-- These policies apply if the anon/authenticated keys are used.
drop policy if exists "vault_folders_owner" on public.vault_folders;
create policy "vault_folders_owner" on public.vault_folders
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists "vault_files_owner" on public.vault_files;
create policy "vault_files_owner" on public.vault_files
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);
