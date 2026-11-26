-- Which source backs each connector. Run after products.sql.
-- Secret values are never stored here; browser connections stay in the browser.

alter table public.products
  add column if not exists connection_sources jsonb not null default '{}'::jsonb;
  -- shape: { "postgres": "browser" | "env", "confluence": ..., "jira": ..., "figma": ... }

alter table public.products
  drop constraint if exists products_connection_sources_valid;
alter table public.products
  add constraint products_connection_sources_valid
  check (connection_sources::text !~* '(password|token|secret|apikey|postgres(ql)?://)');

-- docs_config holds public metadata only (spaceKey, siteUrl, env-var names).
alter table public.products
  drop constraint if exists products_docs_config_no_secrets;
alter table public.products
  add constraint products_docs_config_no_secrets
  check (not docs_config ?| array['token','accessToken','apiKey','password','pat','secret','username','url']);

notify pgrst, 'reload schema';

-- Rollback:
--   alter table public.products drop constraint if exists products_connection_sources_valid;
--   alter table public.products drop column if exists connection_sources;
