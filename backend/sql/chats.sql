-- Chat session metadata and message history. Run in the Supabase SQL editor.
-- Agent graph state stays in-process (MemorySaver); these tables hydrate the GUI
-- and seed a thread after a process restart.

create table if not exists public.chat_threads (
  id text primary key,
  user_id text not null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id text primary key,
  thread_id text not null references public.chat_threads (id) on delete cascade,
  user_id text not null,
  role text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_role_check
    check (role in ('user', 'assistant'))
);

create index if not exists chat_threads_user_updated_idx
  on public.chat_threads (user_id, updated_at desc, id desc);

create index if not exists chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

-- Backend uses the service role key, which bypasses RLS.
-- These policies apply if the anon/authenticated keys are used.
drop policy if exists "chat_threads_owner" on public.chat_threads;
create policy "chat_threads_owner" on public.chat_threads
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

drop policy if exists "chat_messages_owner" on public.chat_messages;
create policy "chat_messages_owner" on public.chat_messages
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);
