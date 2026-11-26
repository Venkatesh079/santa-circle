begin;

create schema santa_private;
revoke all on schema santa_private from public, anon, authenticated;
create table santa_private.circles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  organizer uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 80),
  budget numeric(12,2) not null check (budget >= 0),
  currency text not null check (currency in ('USD','EUR','GBP','INR','CAD','AUD','NZD','JPY')),
  exchange_date date not null,
  message text not null default '' check (length(message) <= 1000),
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);
create table santa_private.people (
  id uuid primary key default gen_random_uuid(),
  circle uuid not null references santa_private.circles on delete cascade,
  account uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 80),
  email text not null,
  interests text not null default '' check(length(interests)<=1000),
  preferences text not null default '' check(length(preferences)<=1000),
  ideas jsonb not null default '[]',
  revealed_at timestamptz,
  unique(circle,account), unique(circle,email), unique(circle,id)
);
create table santa_private.invitations (
  circle uuid references santa_private.circles on delete cascade,
  email text not null check(length(email)<=254),
  primary key(circle,email)
);
create table santa_private.exclusions (
  circle uuid not null, a uuid not null, b uuid not null, check(a<b),
  primary key(circle,a,b),
  foreign key(circle,a) references santa_private.people(circle,id) on delete cascade,
  foreign key(circle,b) references santa_private.people(circle,id) on delete cascade
);
create table santa_private.assignments (
  circle uuid not null, giver uuid not null, recipient uuid not null, check(giver<>recipient),
  primary key(circle,giver), unique(circle,recipient),
  foreign key(circle,giver) references santa_private.people(circle,id),
  foreign key(circle,recipient) references santa_private.people(circle,id)
);
-- Direct access defaults to deny. The public RPC returns narrowly scoped views.
alter table santa_private.circles enable row level security;
alter table santa_private.people enable row level security;
alter table santa_private.invitations enable row level security;
alter table santa_private.exclusions enable row level security;
alter table santa_private.assignments enable row level security;

-- Randomized augmenting paths find a perfect bipartite matching whenever one exists.
-- Only the dispatcher calls this while holding the circle's row lock.
create function santa_private.draw(g uuid) returns void language plpgsql
set search_path = pg_catalog, santa_private, pg_temp as $$
declare
  ids uuid[]; n int; allowed boolean[][]; owner_of int[]; gift_for int[];
  parent int[]; queue int[]; head int; actor int; candidate int; previous int;
  done boolean; origin int; edges record;
begin
  select array_agg(id order by random()) into ids from people where circle=g;
  n:=coalesce(cardinality(ids),0);
  if n<3 then raise exception 'Invite at least three participants before drawing names.'; end if;
  allowed:=array_fill(true,array[n,n]);
  for i in 1..n loop allowed[i][i]:=false; end loop;
  for edges in select array_position(ids,a) x,array_position(ids,b) y from exclusions where circle=g loop
    allowed[edges.x][edges.y]:=false; allowed[edges.y][edges.x]:=false;
  end loop;
  owner_of:=array_fill(0,array[n]); gift_for:=array_fill(0,array[n]);
  for origin in 1..n loop
    parent:=array_fill(0,array[n]); queue:=array[origin]; head:=1; done:=false;
    while head<=cardinality(queue) and not done loop
      actor:=queue[head]; head:=head+1;
      for candidate in select k from generate_series(1,n) k order by random() loop
        if not allowed[actor][candidate] or parent[candidate]<>0 then continue; end if;
        parent[candidate]:=actor;
        if owner_of[candidate]<>0 then
          queue:=array_append(queue,owner_of[candidate]);
        else
          while candidate<>0 loop
            actor:=parent[candidate]; previous:=gift_for[actor];
            gift_for[actor]:=candidate; owner_of[candidate]:=actor; candidate:=previous;
          end loop;
          done:=true; exit;
        end if;
      end loop;
    end loop;
    if not done then raise exception 'These exclusions leave no valid draw. Remove an exclusion or invite another participant and try again.'; end if;
  end loop;
  insert into assignments(circle,giver,recipient) select g,ids[k],ids[gift_for[k]] from generate_series(1,n) k;
  update circles set drawn_at=now() where id=g;
end $$;

create function public.circle_action(op text, p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,santa_private,pg_temp as $$
declare
  uid uuid:=auth.uid(); mail text; c circles; me people; target people; item jsonb;
  admin boolean; x uuid; y uuid; addr text;
begin
  select lower(email) into mail from auth.users where id=uid and email_confirmed_at is not null and coalesce(is_anonymous,false)=false;
  if mail is null then raise exception 'Please verify your email to continue.'; end if;
  if op='list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'date',g.exchange_date,'drawn',g.drawn_at is not null,'organizer',g.organizer=uid) order by g.created_at desc)
      from circles g join people m on m.circle=g.id where m.account=uid),'[]');
  end if;
  if op='create' then
    insert into circles(organizer,name,budget,currency,exchange_date,message)
      values(uid,trim(p->>'name'),(p->>'budget')::numeric,p->>'currency',(p->>'date')::date,trim(coalesce(p->>'message',''))) returning * into c;
    insert into people(circle,account,name,email) values(c.id,uid,trim(p->>'person'),mail);
    return to_jsonb(c.id);
  end if;
  if op='join' then
    select * into c from circles where code=upper(trim(p->>'code')) for update;
    if c.id is null then raise exception 'That group code was not found. Check your invitation and try again.'; end if;
    if exists(select 1 from people where circle=c.id and account=uid) then return to_jsonb(c.id); end if;
    if exists(select 1 from people where circle=c.id and email=mail) then raise exception 'This email already belongs to a participant.'; end if;
    if c.drawn_at is not null then raise exception 'This group has already drawn names.'; end if;
    if (select count(*) from people where circle=c.id)>=100 then raise exception 'This group has reached its 100-person limit.'; end if;
    insert into people(circle,account,name,email) values(c.id,uid,trim(p->>'person'),mail);
    return to_jsonb(c.id);
  end if;
  select * into c from circles where id=(p->>'id')::uuid for update;
  select * into me from people where circle=c.id and account=uid;
  if me.id is null then raise exception 'This circle is unavailable to this account.'; end if;
  admin:=c.organizer=uid;
  if op='view' then
    return jsonb_build_object('id',c.id,'name',c.name,'date',c.exchange_date,'message',c.message,'budget',c.budget,'currency',c.currency,'drawn',c.drawn_at is not null,
      'code',case when admin then c.code end,'organizer',admin,'me',me.id,'myEmail',me.email,'interests',me.interests,'preferences',me.preferences,'ideas',me.ideas,'revealed',me.revealed_at is not null,
      'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'organizer',m.account=c.organizer,'revealed',case when admin then m.revealed_at is not null end) order by m.name,m.id) from people m where m.circle=c.id),'[]'),
      'pending',case when admin then coalesce((select jsonb_agg(i.email order by i.email) from invitations i where i.circle=c.id and not exists(select 1 from people m where m.circle=c.id and m.email=i.email)),'[]') else '[]'::jsonb end,
      'exclusions',case when admin then coalesce((select jsonb_agg(jsonb_build_object('a',e.a,'b',e.b)) from exclusions e where e.circle=c.id),'[]') else '[]'::jsonb end);
  elsif op='wishlist' then
    if jsonb_typeof(p->'ideas') is distinct from 'array' or jsonb_array_length(p->'ideas')>12 then raise exception 'Use up to 12 wishlist items.'; end if;
    for item in select value from jsonb_array_elements(p->'ideas') loop
      if jsonb_typeof(item->'title') is distinct from 'string' or jsonb_typeof(item->'url') is distinct from 'string' or jsonb_typeof(item->'notes') is distinct from 'string' or coalesce(length(trim(item->>'title')),0) not between 1 and 120 or length(coalesce(item->>'notes',''))>500
        or length(coalesce(item->>'url',''))>1500 or (coalesce(item->>'url','')<>'' and (item->>'url') !~* '^https?://[^[:space:]]+$') then raise exception 'Check the wishlist title, link and notes.'; end if;
    end loop;
    update people set ideas=p->'ideas',interests=coalesce(p->>'interests',''),preferences=coalesce(p->>'preferences','') where id=me.id;
  elsif op='reveal' then
    if c.drawn_at is null then raise exception 'The organizer has not drawn names yet.'; end if;
    select m.* into strict target from assignments a join people m on m.id=a.recipient where a.circle=c.id and a.giver=me.id;
    update people set revealed_at=coalesce(revealed_at,now()) where id=me.id;
    return jsonb_build_object('name',target.name,'ideas',target.ideas,'preferences',target.preferences,'interests',target.interests);
  else
    if not admin then raise exception 'Only the organizer can do that.'; end if;
    if c.drawn_at is not null then raise exception 'Names have already been drawn. This circle is locked.'; end if;
    case op
      when 'settings' then
        update circles set name=trim(p->>'name'),budget=(p->>'budget')::numeric,currency=p->>'currency',exchange_date=(p->>'date')::date,message=coalesce(p->>'message','') where id=c.id;
      when 'invite' then
        addr:=lower(trim(p->>'email'));
        if addr is null or addr !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.'; end if;
        if exists(select 1 from people where circle=c.id and email=addr) then raise exception 'This person has already joined.'; end if;
        insert into invitations(circle,email) values(c.id,addr) on conflict do nothing;
      when 'remove' then
        if me.id=(p->>'member')::uuid then raise exception 'The organizer must stay in the circle.'; end if;
        delete from people where circle=c.id and id=(p->>'member')::uuid;
      when 'exclude','allow' then
        x:=least((p->>'a')::uuid,(p->>'b')::uuid); y:=greatest((p->>'a')::uuid,(p->>'b')::uuid);
        if x is null or x=y then raise exception 'Choose two different participants.'; end if;
        if op='exclude' then insert into exclusions values(c.id,x,y) on conflict do nothing;
        else delete from exclusions where circle=c.id and a=x and b=y; end if;
      when 'draw' then perform santa_private.draw(c.id);
      else raise exception 'Unknown circle action.';
    end case;
  end if;
  return 'null'::jsonb;
end $$;
revoke all on function santa_private.draw(uuid) from public,anon,authenticated;
revoke all on function public.circle_action(text,jsonb) from public,anon;
grant execute on function public.circle_action(text,jsonb) to authenticated;
commit;
