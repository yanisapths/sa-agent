-- Products group repos, an optional database, a docs source and an index.
-- Run after workspaces.sql, chats.sql and artifacts.sql. Every statement is idempotent.
-- Secrets are never stored: db_url_env and docs_config.tokenEnv hold env-var NAMES.

create table if not exists public.products (
  id text primary key,                          -- prd_<12 hex>
  user_id text not null,
  slug text not null,                           -- matches .sa/product.json "id"
  name text not null,
  db_url_env text,
  db_schema text not null default 'public',
  docs_provider text not null default 'none',
  docs_config jsonb not null default '{}'::jsonb,     -- { baseUrl?, spaceKey?, siteUrl?, usernameEnv?, tokenEnv? }
  index_config jsonb not null default '{}'::jsonb,    -- { apiSpecCollection?, ddlCollection? }
  model_defaults jsonb not null default '{}'::jsonb,  -- { orchestrator?, discuss?, plan?, execute?, test?, review?, pvtDiscuss?, pvtPlan?, pvtExecute? }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (user_id, name),
  constraint products_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$' and slug <> 'default'),
  constraint products_docs_provider_check
    check (docs_provider in ('confluence', 'none')),
  constraint products_db_env_name
    check (db_url_env is null or db_url_env ~ '^SA_PRODUCT_[A-Z0-9_]+$'),
  constraint products_docs_token_env_name
    check (not docs_config ? 'tokenEnv'
           or docs_config->>'tokenEnv' ~ '^SA_PRODUCT_[A-Z0-9_]+$'),
  constraint products_docs_username_env_name
    check (not docs_config ? 'usernameEnv'
           or docs_config->>'usernameEnv' ~ '^SA_PRODUCT_[A-Z0-9_]+$'),
  constraint products_docs_config_no_secrets
    check (not docs_config ?| array['token','accessToken','apiKey','password','pat','secret'])
);

create index if not exists products_user_id_idx on public.products (user_id);

alter table public.products enable row level security;

-- Backend uses the service role key, which bypasses RLS.
-- These policies apply if the anon/authenticated keys are used.
drop policy if exists "products_owner" on public.products;
create policy "products_owner" on public.products
  for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

-- NULL product_id = the virtual Default product. Existing rows stay valid.
alter table public.workspaces
  add column if not exists product_id text references public.products (id) on delete cascade;
alter table public.chat_threads
  add column if not exists product_id text references public.products (id) on delete set null;
alter table public.artifact_files
  add column if not exists product_id text references public.products (id) on delete set null;

create index if not exists workspaces_user_product_idx
  on public.workspaces (user_id, product_id);
create index if not exists chat_threads_user_product_updated_idx
  on public.chat_threads (user_id, product_id, updated_at desc, id desc);
create index if not exists artifact_files_user_product_idx
  on public.artifact_files (user_id, product_id);

notify pgrst, 'reload schema';

-- Rollback:
--   alter table public.artifact_files drop column if exists product_id;
--   alter table public.chat_threads drop column if exists product_id;
--   alter table public.workspaces drop column if exists product_id;
--   drop table if exists public.products;
