-- Replacing and inserting QA must commit together. A failed import keeps old QA.
create or replace function public.import_qa_csv(
  p_rows jsonb,
  p_replace boolean,
  p_updated_by uuid,
  p_user_rank integer
)
returns setof public.qa
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  result public.qa;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'QA_IMPORT_INVALID_ROWS';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100
     or p_replace is null or p_user_rank is null or p_user_rank < 1 then
    raise exception 'QA_IMPORT_INVALID_ROWS';
  end if;

  -- Serialize replacement with other writes until this short transaction commits.
  if p_replace then
    lock table public.qa in share row exclusive mode;
    if exists (
      select 1 from public.qa q
      join public.permission_level level on level.id = q.required_permission_level_id
      where q.status <> 'deleted' and level.rank > p_user_rank
    ) then
      raise exception 'QA_REPLACE_FORBIDDEN';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) entry
    left join public.permission_level level
      on level.id = (entry->>'required_permission_level_id')::uuid
    where level.id is null or level.rank < 1 or level.rank > p_user_rank
  ) then
    raise exception 'QA_IMPORT_INVALID_PERMISSION';
  end if;

  if p_replace then
    -- Preserve history references; deleted QA is hidden and excluded from RAG.
    update public.qa
    set status = 'deleted', updated_by = p_updated_by, updated_at = now()
    where status <> 'deleted';
  end if;

  -- Return input order so embedding errors can be associated with CSV line numbers.
  for item in select value from jsonb_array_elements(p_rows) loop
    insert into public.qa (
      question, answer, category, tags, required_permission_level_id,
      content_revision, status, updated_by
    ) values (
      btrim(item->>'question'),
      btrim(item->>'answer'),
      nullif(btrim(item->>'category'), ''),
      array(select jsonb_array_elements_text(item->'tags')),
      (item->>'required_permission_level_id')::uuid,
      1, 'active', p_updated_by
    ) returning * into result;
    return next result;
  end loop;
end;
$$;

revoke all on function public.import_qa_csv(jsonb, boolean, uuid, integer) from public, anon, authenticated;
grant execute on function public.import_qa_csv(jsonb, boolean, uuid, integer) to service_role;
notify pgrst, 'reload schema';
