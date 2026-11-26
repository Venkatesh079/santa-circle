begin;
-- Starts with account to support loading a signed-in user's groups.
create index people_account_circle_idx on santa_private.people(account, circle);

-- Apply the INR rule to new budgets without relabeling historical amounts.
create function santa_private.validate_budget() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.currency is distinct from 'INR' then
    raise exception 'Enter a gift budget in INR.';
  end if;
  if new.budget is null or new.budget not between 0 and 999999999.99 then
    raise exception 'Enter a valid gift budget.';
  end if;
  return new;
end $$;

create trigger circles_validate_budget before insert or update of currency,budget
on santa_private.circles for each row execute function santa_private.validate_budget();
revoke all on function santa_private.validate_budget() from public, anon, authenticated;
commit;
