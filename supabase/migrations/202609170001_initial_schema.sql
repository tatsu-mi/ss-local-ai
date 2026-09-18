create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.administrator_accounts (
  id uuid primary key default extensions.gen_random_uuid(),
  email varchar(320) not null,
  display_name varchar(200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint administrator_accounts_email_key unique (email),
  constraint administrator_accounts_email_normalized_check
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

comment on table public.administrator_accounts is
  '運用担当者が手動で登録する管理者アカウント。アプリケーションからは追加・更新しない。';

create table public.permission_level (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  rank integer not null unique check (rank >= 0)
);

create table public.permission_group (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null unique,
  permission_level_id uuid not null references public.permission_level(id),
  can_manage_qa boolean not null default false
);

create table public.app_user (
  id uuid primary key default extensions.gen_random_uuid(),
  email text not null,
  display_name text not null,
  permission_group_id uuid not null references public.permission_group(id),
  created_at timestamptz not null default now(),
  constraint app_user_email_key unique (email),
  constraint app_user_email_normalized_check
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

create table public.qa (
  id uuid primary key default extensions.gen_random_uuid(),
  question text not null check (length(btrim(question)) > 0),
  answer text not null check (length(btrim(answer)) > 0),
  category text,
  tags text[] not null default '{}',
  content_revision integer not null default 1 check (content_revision >= 1),
  embedding extensions.vector(768),
  embedding_profile text,
  embedding_revision integer,
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'ready', 'failed')),
  required_permission_level_id uuid not null references public.permission_level(id),
  status text not null default 'active'
    check (status in ('active', 'excluded', 'deleted')),
  updated_by uuid not null references public.app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (embedding_status = 'ready'
      and embedding is not null
      and embedding_profile is not null
      and embedding_revision = content_revision)
    or
    (embedding_status <> 'ready'
      and embedding is null
      and embedding_profile is null
      and embedding_revision is null)
  )
);

create table public.chat_log (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_user(id),
  conversation_id uuid not null,
  sequence_number integer not null check (sequence_number > 0),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(btrim(content)) > 0),
  citations jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, sequence_number),
  check (role = 'assistant' or citations is null)
);

create index app_user_permission_group_idx on public.app_user(permission_group_id);
create index qa_permission_level_idx on public.qa(required_permission_level_id);
create index qa_search_state_idx
  on public.qa(status, embedding_status, embedding_profile);
create index chat_log_owner_conversation_idx
  on public.chat_log(user_id, conversation_id, sequence_number);

insert into public.permission_level (id, name, rank) values
  ('00000000-0000-0000-0000-000000000001', '未設定', 0),
  ('00000000-0000-0000-0000-000000000002', 'エンジニア', 1),
  ('00000000-0000-0000-0000-000000000003', 'バックオフィス', 2);

insert into public.permission_group
  (id, name, permission_level_id, can_manage_qa)
values
  ('10000000-0000-0000-0000-000000000001', '未設定',
    '00000000-0000-0000-0000-000000000001', false),
  ('10000000-0000-0000-0000-000000000002', 'エンジニア',
    '00000000-0000-0000-0000-000000000002', false),
  ('10000000-0000-0000-0000-000000000003', 'バックオフィス',
    '00000000-0000-0000-0000-000000000003', true);

create trigger administrator_accounts_set_updated_at
before update on public.administrator_accounts
for each row execute function public.set_updated_at();

-- Content changes and vector invalidation happen in one transaction.
create or replace function public.update_qa_content(
  p_qa_id uuid,
  p_expected_revision integer,
  p_question text,
  p_answer text,
  p_category text,
  p_tags text[],
  p_updated_by uuid
)
returns public.qa
language plpgsql
set search_path = ''
as $$
declare
  result public.qa;
begin
  update public.qa
  set question = btrim(p_question),
      answer = btrim(p_answer),
      category = nullif(btrim(p_category), ''),
      tags = coalesce(p_tags, '{}'),
      content_revision = content_revision + 1,
      embedding = null,
      embedding_profile = null,
      embedding_revision = null,
      embedding_status = 'pending',
      updated_by = p_updated_by,
      updated_at = now()
  where id = p_qa_id
    and content_revision = p_expected_revision
    and status <> 'deleted'
  returning * into result;

  if result.id is null then
    raise exception 'QA_NOT_FOUND_OR_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  return result;
end;
$$;

-- A late worker may only publish a vector for the exact pending revision.
create or replace function public.complete_qa_embedding(
  p_qa_id uuid,
  p_revision integer,
  p_profile text,
  p_embedding extensions.vector(768)
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.qa
  set embedding = p_embedding,
      embedding_profile = p_profile,
      embedding_revision = p_revision,
      embedding_status = 'ready',
      updated_at = now()
  where id = p_qa_id
    and content_revision = p_revision
    and embedding_status = 'pending'
    and status = 'active';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.fail_qa_embedding(
  p_qa_id uuid,
  p_revision integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.qa
  set embedding_status = 'failed', updated_at = now()
  where id = p_qa_id
    and content_revision = p_revision
    and embedding_status = 'pending'
    and embedding is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.prepare_qa_embedding_retry(
  p_qa_id uuid,
  p_updated_by uuid
)
returns public.qa
language plpgsql
set search_path = ''
as $$
declare
  result public.qa;
begin
  update public.qa
  set embedding = null,
      embedding_profile = null,
      embedding_revision = null,
      embedding_status = 'pending',
      updated_by = p_updated_by,
      updated_at = now()
  where id = p_qa_id
    and status = 'active'
    and embedding_status in ('failed', 'pending')
  returning * into result;
  return result;
end;
$$;

-- Permission filtering is part of the vector query, before ordering/limit.
create or replace function public.match_qa(
  p_query_embedding extensions.vector(768),
  p_user_rank integer,
  p_profile text,
  p_match_threshold double precision,
  p_match_count integer
)
returns table (
  id uuid,
  question text,
  answer text,
  category text,
  tags text[],
  content_revision integer,
  required_rank integer,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select q.id, q.question, q.answer, q.category, q.tags,
         q.content_revision, pl.rank,
         (1 - (q.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision as similarity
  from public.qa q
  join public.permission_level pl on pl.id = q.required_permission_level_id
  where pl.rank <= p_user_rank
    and q.status = 'active'
    and q.embedding_status = 'ready'
    and q.embedding is not null
    and q.embedding_revision = q.content_revision
    and q.embedding_profile = p_profile
    and 1 - (q.embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_match_threshold
  order by q.embedding OPERATOR(extensions.<=>) p_query_embedding
  limit least(greatest(p_match_count, 1), 50)
$$;

create or replace function public.append_chat_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_content text,
  p_citations jsonb default null
)
returns public.chat_log
language plpgsql
set search_path = ''
as $$
declare
  next_sequence integer;
  existing_owner uuid;
  result public.chat_log;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));
  select user_id into existing_owner
    from public.chat_log
    where conversation_id = p_conversation_id
    limit 1;
  if existing_owner is not null and existing_owner <> p_user_id then
    raise exception 'CONVERSATION_NOT_OWNED' using errcode = 'P0001';
  end if;
  select coalesce(max(sequence_number), 0) + 1 into next_sequence
    from public.chat_log where conversation_id = p_conversation_id;
  insert into public.chat_log
    (user_id, conversation_id, sequence_number, role, content, citations)
  values
    (p_user_id, p_conversation_id, next_sequence, p_role, btrim(p_content), p_citations)
  returning * into result;
  return result;
end;
$$;

alter table public.administrator_accounts enable row level security;
alter table public.permission_level enable row level security;
alter table public.permission_group enable row level security;
alter table public.app_user enable row level security;
alter table public.qa enable row level security;
alter table public.chat_log enable row level security;

revoke all on table public.administrator_accounts from anon, authenticated;
revoke all on table public.permission_level from anon, authenticated;
revoke all on table public.permission_group from anon, authenticated;
revoke all on table public.app_user from anon, authenticated;
revoke all on table public.qa from anon, authenticated;
revoke all on table public.chat_log from anon, authenticated;
grant usage on schema public to service_role;
grant select on table public.administrator_accounts to service_role;
grant select on table public.permission_level to service_role;
grant select on table public.permission_group to service_role;
grant select, insert, update on table public.app_user to service_role;
grant select, insert, update on table public.qa to service_role;
grant select, insert on table public.chat_log to service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.update_qa_content from public, anon, authenticated;
revoke all on function public.complete_qa_embedding from public, anon, authenticated;
revoke all on function public.fail_qa_embedding from public, anon, authenticated;
revoke all on function public.prepare_qa_embedding_retry from public, anon, authenticated;
revoke all on function public.match_qa from public, anon, authenticated;
revoke all on function public.append_chat_message from public, anon, authenticated;
grant execute on function public.update_qa_content to service_role;
grant execute on function public.complete_qa_embedding to service_role;
grant execute on function public.fail_qa_embedding to service_role;
grant execute on function public.prepare_qa_embedding_retry to service_role;
grant execute on function public.match_qa to service_role;
grant execute on function public.append_chat_message to service_role;

notify pgrst, 'reload schema';

-- 管理者は運用担当者がSQL Editorなどから明示的に手動登録する。
-- insert into public.administrator_accounts (email, display_name)
-- values ('admin@example.com', '管理者名');
