begin;

create function santa_private.restrict_group_creation() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not exists (
    select 1 from auth.users
    where id=auth.uid() and id=new.organizer
      and lower(email)='venkatesh.chappavarapu7@gmail.com'
      and email_confirmed_at is not null
      and coalesce(is_anonymous,false)=false
  ) then
    raise exception 'Group creation is restricted to the administrator.';
  end if;
  return new;
end $$;
revoke all on function santa_private.restrict_group_creation() from public,anon,authenticated;
create trigger circles_restrict_creation before insert on santa_private.circles
for each row execute function santa_private.restrict_group_creation();

commit;
