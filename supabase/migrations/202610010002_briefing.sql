begin;

-- Ephemeral presentation state is deliberately separate from project data and operation history.
create table public.ast_briefings (
    project_id uuid primary key references public.ast_projects(id) on delete cascade,
    presenter_id uuid not null references auth.users(id),
    session_id uuid not null,
    phase_id uuid,
    camera jsonb,
    expires_at timestamptz not null
);
alter table public.ast_briefings enable row level security;
revoke all on public.ast_briefings from public, anon, authenticated;

-- Only RPC reads: include server-relative TTL and check the presenter's current role.
create function public.ast_briefing(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare state public.ast_briefings; role text;
begin
    if public.ast_role(p_project) is null then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into state from public.ast_briefings where project_id=p_project;
    select m.role into role from public.ast_memberships m where m.project_id=p_project and m.user_id=state.presenter_id;
    if state.project_id is null or state.expires_at <= clock_timestamp() or coalesce(role,'') not in ('owner','admin') then
        return null;
    end if;
    return jsonb_build_object('presenterId',state.presenter_id,'sessionId',state.session_id,
        'phaseId',state.phase_id,'camera',state.camera,
        'remainingMs',greatest(0,extract(epoch from (state.expires_at-clock_timestamp()))*1000));
end;
$$;

create function public.ast_present(p_project uuid, p_session uuid, p_action text, p_phase uuid, p_camera jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare state public.ast_briefings; doc jsonb; active_role text;
begin
    -- Same lock order as project writes and membership changes: authorization cannot race revocation.
    select document into doc from public.ast_projects where id=p_project for update;
    if doc is null or coalesce(public.ast_role(p_project),'') not in ('owner','admin') then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    if p_session is null or p_action is null or p_action not in ('claim','update','release') then
        raise exception 'invalid_presentation' using errcode = '22023';
    end if;
    select * into state from public.ast_briefings where project_id=p_project;
    select m.role into active_role from public.ast_memberships m where m.project_id=p_project and m.user_id=state.presenter_id;
    if p_action='claim' then
        if state.expires_at > clock_timestamp() and coalesce(active_role,'') in ('owner','admin')
            and (state.session_id <> p_session or state.presenter_id <> auth.uid()) then
            raise exception 'already_presenting' using errcode = '40001';
        end if;
    elsif state.project_id is null or state.session_id <> p_session or state.presenter_id <> auth.uid() or state.expires_at <= clock_timestamp() then
        raise exception 'presentation_expired' using errcode = '40001';
    end if;
    if p_action='release' then
        delete from public.ast_briefings where project_id=p_project;
        return null;
    end if;
    if p_phase is not null and not exists(select 1 from jsonb_array_elements(doc->'phases') x where x->>'id'=p_phase::text) then
        raise exception 'invalid_phase' using errcode = '22023';
    end if;
    if p_camera is not null and not ast_private.matches(p_camera,
        '{"type":"object","required":["center","zoom","bearing","pitch"],"additionalProperties":false,"properties":{"center":{"type":"array","minItems":2,"maxItems":2,"items":{"type":"number","minimum":-180,"maximum":180}},"zoom":{"type":"number","minimum":0,"maximum":24},"bearing":{"type":"number","minimum":-180,"maximum":180},"pitch":{"type":"number","minimum":0,"maximum":85}}}'::jsonb) then
        raise exception 'invalid_camera' using errcode = '22023';
    end if;
    if p_camera is not null and abs((p_camera->'center'->>1)::numeric)>90 then
        raise exception 'invalid_camera' using errcode = '22023';
    end if;
    insert into public.ast_briefings values(p_project,auth.uid(),p_session,p_phase,p_camera,clock_timestamp()+interval '20 seconds')
        on conflict(project_id) do update set presenter_id=excluded.presenter_id,session_id=excluded.session_id,
            phase_id=excluded.phase_id,camera=excluded.camera,expires_at=excluded.expires_at;
    return public.ast_briefing(p_project);
end;
$$;
revoke all on function public.ast_briefing(uuid), public.ast_present(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.ast_briefing(uuid), public.ast_present(uuid,uuid,text,uuid,jsonb) to authenticated;
commit;
