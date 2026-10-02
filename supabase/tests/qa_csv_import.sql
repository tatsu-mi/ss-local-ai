-- Run against an isolated test database after applying the migrations.
-- All changes made by this test are rolled back.
begin;

insert into public.app_user (id, email, display_name, permission_group_id)
values ('20000000-0000-4000-8000-000000000099', 'csv-test@example.com', 'CSV test', '10000000-0000-0000-0000-000000000003');

set local role service_role;

do $$
declare
  actor uuid := '20000000-0000-4000-8000-000000000099';
  old_id uuid;
  imported public.qa;
  valid_rows jsonb := '[{"question":"新しい質問","answer":"回答","category":"カテゴリ","tags":["総務","申請"],"required_permission_level_id":"00000000-0000-0000-0000-000000000003"}]';
  bad_rows jsonb;
  before_count integer;
begin
  insert into public.qa (question, answer, required_permission_level_id, content_revision, status, updated_by)
  values ('既存質問', '既存回答', '00000000-0000-0000-0000-000000000003', 7, 'excluded', actor)
  returning id into old_id;

  select * into imported from public.import_qa_csv(valid_rows, false, actor, 2);
  if imported.content_revision <> 1 or imported.status <> 'active' or imported.id = old_id
     or imported.tags <> array['総務', '申請'] then
    raise exception 'Append must create a new active revision 1 QA with plain tags';
  end if;
  if not exists (select 1 from public.qa where id = old_id and status = 'excluded' and content_revision = 7) then
    raise exception 'Append changed the existing QA';
  end if;
  select count(*) into before_count from public.qa;

  bad_rows := '[{"question":"質問","answer":"回答","tags":[],"required_permission_level_id":"00000000-0000-0000-0000-000000000099"}]';
  begin
    perform public.import_qa_csv(bad_rows, true, actor, 2);
    raise exception 'Invalid permissions should be rejected';
  exception when raise_exception then
    if sqlerrm <> 'QA_IMPORT_INVALID_PERMISSION' then raise; end if;
  end;
  if not exists (select 1 from public.qa where id = old_id and status = 'excluded') then
    raise exception 'Invalid permissions deleted existing QA';
  end if;

  begin
    perform public.import_qa_csv(valid_rows, true, actor, 1);
    raise exception 'Replacement of inaccessible QA should be rejected';
  exception when raise_exception then
    if sqlerrm <> 'QA_REPLACE_FORBIDDEN' then raise; end if;
  end;

  -- A later insert fails after the old rows are marked deleted and the first new row is inserted.
  bad_rows := valid_rows || '[{"question":"質問","answer":" ","tags":[],"required_permission_level_id":"00000000-0000-0000-0000-000000000003"}]'::jsonb;
  begin
    perform public.import_qa_csv(bad_rows, true, actor, 2);
    raise exception 'Blank answers should fail';
  exception when check_violation then null;
  end;
  if (select count(*) from public.qa) <> before_count
     or not exists (select 1 from public.qa where id = old_id and status = 'excluded')
     or not exists (select 1 from public.qa where id = imported.id and status = 'active') then
    raise exception 'A failed replacement was not fully rolled back';
  end if;

  select * into imported from public.import_qa_csv(valid_rows, true, actor, 2);
  if imported.content_revision <> 1 or imported.status <> 'active'
     or (select count(*) from public.qa where status <> 'deleted') <> 1
     or not exists (select 1 from public.qa where id = old_id and status = 'deleted') then
    raise exception 'Replacement did not replace all QA with new revision 1 active QA';
  end if;
  perform public.import_qa_csv(valid_rows, false, actor, 2);
  perform public.import_qa_csv(valid_rows, false, actor, 2);
  if (select count(*) from public.qa where status = 'active') <> 3
     or exists (select 1 from public.qa where status = 'active' and content_revision <> 1) then
    raise exception 'Each append should insert every CSV row as a new QA';
  end if;

  if has_function_privilege('anon', 'public.import_qa_csv(jsonb,boolean,uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_qa_csv(jsonb,boolean,uuid,integer)', 'EXECUTE') then
    raise exception 'Untrusted roles can call the import function';
  end if;
end;
$$;

rollback;
