create or replace function public.list_chat_conversations(
  p_user_id uuid,
  p_limit integer default 50
)
returns table (
  conversation_id uuid,
  title text,
  message_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    log.conversation_id,
    coalesce(
      left(
        (array_agg(log.content order by log.sequence_number)
          filter (where log.role = 'user'))[1],
        80
      ),
      '会話'
    ) as title,
    count(*)::integer as message_count,
    min(log.created_at) as created_at,
    max(log.created_at) as updated_at
  from public.chat_log log
  where log.user_id = p_user_id
  group by log.conversation_id
  order by updated_at desc
  limit least(greatest(p_limit, 1), 100)
$$;

create or replace function public.delete_chat_conversation(
  p_user_id uuid,
  p_conversation_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.chat_log
  where user_id = p_user_id
    and conversation_id = p_conversation_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

grant delete on table public.chat_log to service_role;
revoke all on function public.list_chat_conversations from public, anon, authenticated;
revoke all on function public.delete_chat_conversation from public, anon, authenticated;
grant execute on function public.list_chat_conversations to service_role;
grant execute on function public.delete_chat_conversation to service_role;

notify pgrst, 'reload schema';
