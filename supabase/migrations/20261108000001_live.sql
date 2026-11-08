-- AS-TAC 1.0 live collaboration.
-- Clients never write tables directly: every change is a security-definer RPC that checks the
-- caller's role first. Members read through RLS; viewers can read but never write; the admin
-- chat is invisible to viewers. Own GPS positions are never sent here (no column exists for it).
begin;

create table public.live_plans (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 120),
    owner_id uuid not null references auth.users(id) on delete cascade,
    area_id text check (area_id is null or char_length(area_id) <= 120),
    seq bigint not null default 0 check (seq >= 0),
    created_at timestamptz not null default now()
);
create index live_plans_owner on public.live_plans(owner_id);

create table public.live_members (
    plan_id uuid not null references public.live_plans(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'viewer')),
    display_name text not null default '' check (char_length(display_name) <= 40),
    joined_at timestamptz not null default now(),
    primary key (plan_id, user_id)
);
create index live_members_user on public.live_members(user_id);

-- One row per plan entity. `version` is the optimistic-concurrency token; deletes keep a
-- tombstone (data null) so peers learn about them through `seq`.
create table public.live_entities (
    plan_id uuid not null references public.live_plans(id) on delete cascade,
    collection text not null check (collection in ('meta', 'order', 'layers', 'teams', 'images', 'phases', 'elements', 'drawings', 'log')),
    entity_id text not null check (entity_id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
    data jsonb check (data is null or (jsonb_typeof(data) in ('object', 'array') and pg_column_size(data) <= 262144)),
    version bigint not null check (version >= 1),
    seq bigint not null,
    updated_by uuid references auth.users(id) on delete set null,
    client_id text check (client_id is null or char_length(client_id) <= 64),
    updated_at timestamptz not null default now(),
    primary key (plan_id, collection, entity_id)
);
create index live_entities_seq on public.live_entities(plan_id, seq);

create table public.live_invites (
    code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
    plan_id uuid not null references public.live_plans(id) on delete cascade,
    role text not null check (role in ('admin', 'viewer')),
    created_by uuid not null references auth.users(id) on delete cascade,
    expires_at timestamptz not null
);
create index live_invites_plan on public.live_invites(plan_id);

create table public.live_chat (
    id bigint generated always as identity primary key,
    plan_id uuid not null references public.live_plans(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    display_name text not null default '' check (char_length(display_name) <= 40),
    body text not null check (char_length(body) between 1 and 1000),
    created_at timestamptz not null default now()
);
create index live_chat_plan on public.live_chat(plan_id, id);

alter table public.live_plans enable row level security;
alter table public.live_members enable row level security;
alter table public.live_entities enable row level security;
alter table public.live_invites enable row level security;
alter table public.live_chat enable row level security;
revoke all on public.live_plans, public.live_members, public.live_entities, public.live_invites, public.live_chat from public, anon, authenticated;
grant select on public.live_plans, public.live_members, public.live_entities, public.live_chat to authenticated;

create function public.live_role(p_plan uuid) returns text
language sql stable security definer set search_path = '' as $$
    select role from public.live_members where plan_id = p_plan and user_id = auth.uid();
$$;

create policy live_plans_read on public.live_plans for select to authenticated using (public.live_role(id) is not null);
create policy live_members_read on public.live_members for select to authenticated using (public.live_role(plan_id) is not null);
create policy live_entities_read on public.live_entities for select to authenticated using (public.live_role(plan_id) is not null);
create policy live_chat_read on public.live_chat for select to authenticated using (public.live_role(plan_id) in ('owner', 'admin'));
-- live_invites: no policy at all → no direct access; only the RPCs below touch it.

create function public.live_require(p_plan uuid, p_roles text[]) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text;
begin
    if auth.uid() is null then
        raise exception 'unauthenticated' using errcode = '42501';
    end if;
    r := public.live_role(p_plan);
    if r is null or not (r = any(p_roles)) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    return r;
end;
$$;

create function public.live_create_plan(p_name text, p_area text, p_display text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'unauthenticated' using errcode = '42501';
    end if;
    if (select count(*) from public.live_plans where owner_id = auth.uid()) >= 50 then
        raise exception 'limit';
    end if;
    insert into public.live_plans (name, owner_id, area_id) values (left(btrim(p_name), 120), auth.uid(), nullif(left(p_area, 120), '')) returning id into v_id;
    insert into public.live_members (plan_id, user_id, role, display_name) values (v_id, auth.uid(), 'owner', left(coalesce(p_display, ''), 40));
    return v_id;
end;
$$;

-- Apply a batch of entity changes. Each op carries the version it was based on (`base`, 0 = new).
-- A stale base is never applied: the current server value comes back as a conflict instead,
-- so nobody's work is overwritten silently.
create function public.live_push(p_plan uuid, p_ops jsonb, p_client text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    op jsonb;
    v_seq bigint;
    v_cur public.live_entities;
    v_base bigint;
    v_version bigint;
    v_applied jsonb := '[]'::jsonb;
    v_conflicts jsonb := '[]'::jsonb;
    v_count bigint;
begin
    perform public.live_require(p_plan, array['owner', 'admin']);
    if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 500 then
        raise exception 'batch';
    end if;
    -- Serialise pushes per plan: one monotonic sequence, no lost updates.
    select seq into v_seq from public.live_plans where id = p_plan for update;
    for op in select value from jsonb_array_elements(p_ops) loop
        v_base := coalesce((op->>'base')::bigint, 0);
        select * into v_cur from public.live_entities
            where plan_id = p_plan and collection = op->>'collection' and entity_id = op->>'entityId';
        if coalesce(v_cur.version, 0) <> v_base then
            v_conflicts := v_conflicts || jsonb_build_object('collection', op->>'collection', 'entityId', op->>'entityId',
                'version', coalesce(v_cur.version, 0), 'data', v_cur.data);
            continue;
        end if;
        v_seq := v_seq + 1;
        v_version := coalesce(v_cur.version, 0) + 1;
        insert into public.live_entities (plan_id, collection, entity_id, data, version, seq, updated_by, client_id, updated_at)
            values (p_plan, op->>'collection', op->>'entityId', case when jsonb_typeof(op->'data') = 'null' then null else op->'data' end,
                    v_version, v_seq, auth.uid(), left(p_client, 64), now())
            on conflict (plan_id, collection, entity_id) do update
            set data = excluded.data, version = excluded.version, seq = excluded.seq, updated_by = excluded.updated_by,
                client_id = excluded.client_id, updated_at = excluded.updated_at;
        if op->>'collection' = 'meta' and jsonb_typeof(op->'data') = 'object' then
            update public.live_plans set name = coalesce(nullif(left(btrim(op->'data'->>'name'), 120), ''), name), area_id = left(op->'data'->>'areaId', 120)
                where id = p_plan;
        end if;
        v_applied := v_applied || jsonb_build_object('collection', op->>'collection', 'entityId', op->>'entityId', 'version', v_version, 'seq', v_seq);
    end loop;
    select count(*) into v_count from public.live_entities where plan_id = p_plan and data is not null;
    if v_count > 30000 then
        raise exception 'limit';
    end if;
    update public.live_plans set seq = v_seq where id = p_plan;
    return jsonb_build_object('applied', v_applied, 'conflicts', v_conflicts);
end;
$$;

create function public.live_create_invite(p_plan uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_bytes bytea;
    v_code text;
    i int;
begin
    perform public.live_require(p_plan, array['owner', 'admin']);
    if p_role not in ('admin', 'viewer') then
        raise exception 'role';
    end if;
    delete from public.live_invites where plan_id = p_plan and expires_at < now();
    if (select count(*) from public.live_invites where plan_id = p_plan) >= 20 then
        raise exception 'limit';
    end if;
    loop
        v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
        v_code := '';
        for i in 0..7 loop
            v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
        end loop;
        exit when not exists (select 1 from public.live_invites where code = v_code);
    end loop;
    insert into public.live_invites (code, plan_id, role, created_by, expires_at) values (v_code, p_plan, p_role, auth.uid(), now() + interval '24 hours');
    return v_code;
end;
$$;

-- Redeeming never lowers an existing role and never grants owner.
create function public.live_redeem_invite(p_code text, p_display text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv public.live_invites; v_role text; v_plan public.live_plans;
begin
    if auth.uid() is null then
        raise exception 'unauthenticated' using errcode = '42501';
    end if;
    select * into v_inv from public.live_invites where code = upper(btrim(p_code)) and expires_at > now();
    if v_inv.code is null then
        raise exception 'invite';
    end if;
    v_role := public.live_role(v_inv.plan_id);
    if v_role is null then
        insert into public.live_members (plan_id, user_id, role, display_name) values (v_inv.plan_id, auth.uid(), v_inv.role, left(coalesce(p_display, ''), 40));
        v_role := v_inv.role;
    elsif v_role = 'viewer' and v_inv.role = 'admin' then
        update public.live_members set role = 'admin' where plan_id = v_inv.plan_id and user_id = auth.uid();
        v_role := 'admin';
    end if;
    select * into v_plan from public.live_plans where id = v_inv.plan_id;
    return jsonb_build_object('planId', v_plan.id, 'name', v_plan.name, 'areaId', v_plan.area_id, 'role', v_role);
end;
$$;

create function public.live_set_display(p_plan uuid, p_display text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    perform public.live_require(p_plan, array['owner', 'admin', 'viewer']);
    update public.live_members set display_name = left(coalesce(p_display, ''), 40) where plan_id = p_plan and user_id = auth.uid();
end;
$$;

-- Owner manages roles; nobody can make a second owner or demote the owner.
create function public.live_set_role(p_plan uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
    perform public.live_require(p_plan, array['owner']);
    if p_role not in ('admin', 'viewer') or p_user = auth.uid() then
        raise exception 'role';
    end if;
    update public.live_members set role = p_role where plan_id = p_plan and user_id = p_user and role <> 'owner';
end;
$$;

create function public.live_remove_member(p_plan uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
    v_role := public.live_require(p_plan, array['owner', 'admin', 'viewer']);
    if p_user = auth.uid() then
        if v_role = 'owner' then
            raise exception 'owner';
        end if;
    elsif v_role <> 'owner' then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    delete from public.live_members where plan_id = p_plan and user_id = p_user and role <> 'owner';
end;
$$;

create function public.live_delete_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
    perform public.live_require(p_plan, array['owner']);
    delete from public.live_plans where id = p_plan;
end;
$$;

create function public.live_chat_send(p_plan uuid, p_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_name text;
begin
    perform public.live_require(p_plan, array['owner', 'admin']);
    select display_name into v_name from public.live_members where plan_id = p_plan and user_id = auth.uid();
    insert into public.live_chat (plan_id, user_id, display_name, body) values (p_plan, auth.uid(), coalesce(v_name, ''), left(btrim(p_body), 1000)) returning id into v_id;
    return v_id;
end;
$$;

-- Role for a realtime topic or storage path; `null` for anything malformed (never an error).
create function public.live_topic_role(p_topic text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
    if p_topic ~ '^plan:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return public.live_role(substr(p_topic, 6)::uuid);
    end if;
    return null;
end;
$$;

create function public.live_path_role(p_path text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
    if p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}$' then
        return public.live_role(substr(p_path, 1, 36)::uuid);
    end if;
    return null;
end;
$$;

revoke all on function public.live_role(uuid), public.live_require(uuid, text[]), public.live_create_plan(text, text, text),
    public.live_push(uuid, jsonb, text), public.live_create_invite(uuid, text), public.live_redeem_invite(text, text),
    public.live_set_display(uuid, text), public.live_set_role(uuid, uuid, text), public.live_remove_member(uuid, uuid),
    public.live_delete_plan(uuid), public.live_chat_send(uuid, text), public.live_topic_role(text), public.live_path_role(text) from public, anon;
grant execute on function public.live_create_plan(text, text, text), public.live_push(uuid, jsonb, text), public.live_create_invite(uuid, text),
    public.live_redeem_invite(text, text), public.live_set_display(uuid, text), public.live_set_role(uuid, uuid, text),
    public.live_remove_member(uuid, uuid), public.live_delete_plan(uuid), public.live_chat_send(uuid, text), public.live_role(uuid),
    public.live_topic_role(text), public.live_path_role(text) to authenticated;

-- Supabase-only parts (skipped where the schemas don't exist, e.g. in the PGlite test).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.live_entities, public.live_chat;
    end if;
    -- Private realtime channels `plan:<id>`: members receive and send presence; only admins broadcast.
    if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
        execute $p$create policy live_channel_receive on realtime.messages for select to authenticated
            using (public.live_topic_role(realtime.topic()) is not null)$p$;
        execute $p$create policy live_channel_send on realtime.messages for insert to authenticated
            with check (public.live_topic_role(realtime.topic()) is not null
                and (realtime.messages.extension = 'presence' or public.live_topic_role(realtime.topic()) in ('owner', 'admin')))$p$;
    end if;
    -- Image maps and logos: private bucket, path `<plan id>/<sha256>`, passive image types only.
    if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            values ('live-assets', 'live-assets', false, 41943040, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
            on conflict (id) do nothing;
        execute $p$create policy live_assets_read on storage.objects for select to authenticated
            using (bucket_id = 'live-assets' and public.live_path_role(name) is not null)$p$;
        execute $p$create policy live_assets_write on storage.objects for insert to authenticated
            with check (bucket_id = 'live-assets' and public.live_path_role(name) in ('owner', 'admin'))$p$;
    end if;
end;
$$;

commit;
