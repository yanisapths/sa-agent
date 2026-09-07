-- Local project folders the chat agent can read and write.
-- Paths live on the machine running the backend; this table stores pointers.

create table if not exists public.workspaces (
  id text primary key,
  user_id text not null,
  name text not null,
  path text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists workspaces_user_id_idx on public.workspaces (user_id);

alter table public.workspaces enable row level security;

-- Backend uses the service role key, which bypasses RLS.
-- These policies apply if the anon/authenticated keys are used.
drop policy if exists "workspaces_owner" on public.workspaces;
create policy "workspaces_owner" on public.workspaces
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);
