begin;

-- Format 2 adds event metadata and ordered layers. Format 1 stays readable.
create or replace function ast_private.project_schema() returns jsonb language sql immutable set search_path = '' as $schema$
select '{"type":"object","properties":{"id":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"schemaVersion":{"type":"number","enum":[1,2]},"name":{"type":"string","max":120,"nonempty":true},"mapPackageId":{"type":"string","enum":["benglen","mahlwinkel"]},"teams":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"name":{"type":"string","max":120,"nonempty":true},"shortLabel":{"type":"string","max":12,"nonempty":true},"colour":{"type":"string","max":7,"nonempty":false,"pattern":"^#[0-9a-fA-F]{6}$"}},"required":["id","name","shortLabel","colour"]},"min":0,"max":100},"phases":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"order":{"type":"number","min":0,"max":9007199254740991,"integer":true},"title":{"type":"string","max":120,"nonempty":true},"notes":{"type":"string","max":10000,"nonempty":false},"camera":{"anyOf":[{"type":"null"},{"type":"object","properties":{"center":{"type":"array","items":{"type":"number","min":-180,"max":180,"integer":false},"min":2,"max":2},"zoom":{"type":"number","min":0,"max":24,"integer":false},"bearing":{"type":"number","min":-360,"max":360,"integer":false},"pitch":{"type":"number","min":0,"max":85,"integer":false}},"required":["center","zoom","bearing","pitch"]}]},"visibleElementIds":{"type":"array","items":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"min":0,"max":500,"unique":true}},"required":["id","order","title","notes","camera","visibleElementIds"]},"min":0,"max":100},"elements":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"projectId":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"type":{"type":"string","enum":["point","text","line","freehand","polygon","circle"]},"geometry":{"anyOf":[{"type":"object","properties":{"type":{"type":"string","enum":["Point"]},"coordinates":{"type":"array","items":{"type":"number","min":-180,"max":180,"integer":false},"min":2,"max":2}},"required":["type","coordinates"]},{"type":"object","properties":{"type":{"type":"string","enum":["LineString"]},"coordinates":{"type":"array","items":{"type":"array","items":{"type":"number","min":-180,"max":180,"integer":false},"min":2,"max":2},"min":2,"max":5000}},"required":["type","coordinates"]},{"type":"object","properties":{"type":{"type":"string","enum":["Polygon"]},"coordinates":{"type":"array","items":{"type":"array","items":{"type":"array","items":{"type":"number","min":-180,"max":180,"integer":false},"min":2,"max":2},"min":4,"max":5000},"min":1,"max":100}},"required":["type","coordinates"]},{"type":"object","properties":{"type":{"type":"string","enum":["Circle"]},"center":{"type":"array","items":{"type":"number","min":-180,"max":180,"integer":false},"min":2,"max":2},"radiusMeters":{"type":"number","min":0.1,"max":100000,"integer":false}},"required":["type","center","radiusMeters"]}]},"label":{"type":"string","max":200,"nonempty":false},"notes":{"type":"string","max":10000,"nonempty":false},"teamId":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"phaseIds":{"type":"array","items":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"min":0,"max":500,"unique":true},"style":{"type":"object","properties":{"colour":{"type":"string","max":7,"nonempty":false,"pattern":"^#[0-9a-fA-F]{6}$"},"width":{"type":"number","min":1,"max":20,"integer":false},"opacity":{"type":"number","min":0,"max":1,"integer":false}},"required":["colour","width","opacity"]},"version":{"type":"number","min":1,"max":9007199254740991,"integer":true},"deletedAt":{"type":"string","max":24,"nonempty":false,"pattern":"^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$"},"layerId":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"sourceId":{"type":"string","max":200,"nonempty":true}},"required":["id","projectId","type","geometry","label","notes","phaseIds","style","version"]},"min":0,"max":500},"workspace":{"type":"object","required":["layers","siteId","eventId","edition","source"],"properties":{"layers":{"type":"array","max":32,"items":{"type":"object","required":["id","name","opacity","locked"],"properties":{"id":{"type":"string","max":36,"nonempty":false,"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},"name":{"type":"string","max":80,"nonempty":true},"opacity":{"type":"number","min":0,"max":1},"locked":{"type":"boolean"}}}},"siteId":{"type":"string","max":120},"eventId":{"type":"string","max":120},"edition":{"type":"string","max":120},"source":{"type":"string","max":2000}}}},"required":["id","schemaVersion","name","mapPackageId","teams","phases","elements"]}'::jsonb;
$schema$;

create or replace function ast_private.validate_project(doc jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare item jsonb; geom jsonb; line jsonb; point jsonb; coords jsonb; vertices int := 0;
begin
    if octet_length(doc::text) > 4194304 or not ast_private.matches(doc, ast_private.project_schema()) then
        raise exception 'invalid_project' using errcode = '22023';
    end if;
    if doc->>'schemaVersion' = '1' and (doc ? 'workspace' or exists(select 1 from jsonb_array_elements(doc->'elements') e where e ?| array['layerId','sourceId'])) then
        raise exception 'invalid_project' using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements((doc->'teams') || (doc->'phases') || (doc->'elements') || coalesce(doc->'workspace'->'layers','[]'::jsonb)))
        or (select count(*) <> count(distinct value->>'order') from jsonb_array_elements(doc->'phases')) then
        raise exception 'duplicate_ids_or_order' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(doc->'phases') loop
        if exists(select 1 from jsonb_array_elements_text(item->'visibleElementIds') r where not exists(
            select 1 from jsonb_array_elements(doc->'elements') e where e->>'id' = r and not e ? 'deletedAt'))
            or (item->'camera' <> 'null'::jsonb and abs((item->'camera'->'center'->>1)::numeric) > 90) then
            raise exception 'invalid_phase' using errcode = '22023';
        end if;
    end loop;
    for item in select value from jsonb_array_elements(doc->'elements') loop
        if item->>'projectId' <> doc->>'id'
            or (item ? 'layerId' and not exists(select 1 from jsonb_array_elements(coalesce(doc->'workspace'->'layers','[]'::jsonb)) l where l->>'id' = item->>'layerId'))
            or (item ? 'teamId' and not exists(select 1 from jsonb_array_elements(doc->'teams') t where t->>'id' = item->>'teamId'))
            or exists(select 1 from jsonb_array_elements_text(item->'phaseIds') r where not exists(select 1 from jsonb_array_elements(doc->'phases') p where p->>'id' = r)) then
            raise exception 'invalid_reference' using errcode = '22023';
        end if;
        if item ? 'deletedAt' and to_char((item->>'deletedAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> item->>'deletedAt' then
            raise exception 'invalid_timestamp' using errcode = '22023';
        end if;
        geom := item->'geometry';
        if geom->>'type' <> (case item->>'type' when 'point' then 'Point' when 'text' then 'Point' when 'line' then 'LineString' when 'freehand' then 'LineString' when 'circle' then 'Circle' when 'polygon' then 'Polygon' end) then
            raise exception 'invalid_geometry' using errcode = '22023';
        end if;
        coords := case geom->>'type' when 'Circle' then jsonb_build_array(jsonb_build_array(geom->'center')) when 'Point' then jsonb_build_array(jsonb_build_array(geom->'coordinates')) when 'LineString' then jsonb_build_array(geom->'coordinates') else geom->'coordinates' end;
        for line in select value from jsonb_array_elements(coords) loop
            vertices := vertices + jsonb_array_length(line);
            if geom->>'type' = 'Polygon' and (line->0 <> line->-1 or (select count(distinct value) from jsonb_array_elements(line)) < 3) then
                raise exception 'invalid_ring' using errcode = '22023';
            end if;
            for point in select value from jsonb_array_elements(line) loop
                if abs((point->>1)::numeric) > 90 then raise exception 'invalid_latitude' using errcode = '22023'; end if;
            end loop;
        end loop;
    end loop;
    if vertices > 100000 then raise exception 'vertex_limit' using errcode = '22023'; end if;
end;
$$;

create or replace function public.ast_apply(p_project uuid, p_op uuid, p_project_version bigint, p_changes jsonb) returns public.ast_operations
language plpgsql security definer set search_path = '' as $$
<<mutation>>
declare record public.ast_projects; previous public.ast_operations; result public.ast_operations;
    doc jsonb; versions jsonb; command jsonb; kind text; scope text; list_key text; object_id text;
    value jsonb; old_version bigint; next_list jsonb; touched text[] := '{}'; structural boolean := false;
begin
    select * into record from public.ast_projects where id = p_project for update;
    if record.id is null or coalesce(public.ast_role(p_project),'') not in ('owner','admin') then raise exception 'forbidden' using errcode = '42501'; end if;
    select * into previous from public.ast_operations where project_id=p_project and op_id=p_op;
    if found then
        if previous.actor_id <> auth.uid() or previous.payload <> jsonb_build_object('projectVersion',p_project_version,'changes',p_changes) then
            raise exception 'operation_id_reused' using errcode = '22023';
        end if;
        return previous;
    end if;
    if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 500 or octet_length(p_changes::text)>4194304 then
        raise exception 'invalid_batch' using errcode = '22023';
    end if;
    doc := record.document;
    versions := record.versions;
    for command in select * from jsonb_array_elements(p_changes) loop
        if jsonb_typeof(command) <> 'object' or not command ?& array['kind','id','value','expectedVersion']
            or (select count(*) from jsonb_object_keys(command)) <> 4
            or jsonb_typeof(command->'expectedVersion') <> 'number' then raise exception 'invalid_command' using errcode = '22023'; end if;
        kind := command->>'kind'; object_id := command->>'id'; value := command->'value';
        if kind not in ('project','element','team','phase') or object_id is null then raise exception 'invalid_command' using errcode = '22023'; end if;
        perform object_id::uuid;
        scope := case when kind='project' then 'project' else kind || ':' || object_id end;
        if scope = any(touched) then raise exception 'duplicate_command' using errcode = '22023'; end if;
        touched := array_append(touched,scope);
        old_version := coalesce((versions->>scope)::bigint,0);
        if (command->>'expectedVersion')::numeric <> old_version then raise exception 'version_conflict' using errcode = '40001'; end if;
        if kind <> 'element' then structural := true; end if;
        if kind='project' then
            if object_id <> p_project::text or jsonb_typeof(value) <> 'object' or (value - 'name' - 'mapPackageId' - 'schemaVersion' - 'workspace') <> '{}'::jsonb then raise exception 'invalid_metadata' using errcode = '22023'; end if;
            doc := doc || value;
            if doc->'workspace' = 'null'::jsonb then doc := doc - 'workspace'; end if;
        else
            list_key := case kind when 'element' then 'elements' when 'team' then 'teams' when 'phase' then 'phases' end;
            if value <> 'null'::jsonb and (jsonb_typeof(value) <> 'object' or value->>'id' is distinct from object_id) then raise exception 'invalid_id' using errcode = '22023'; end if;
            if kind='element' and value <> 'null'::jsonb and (value->>'version')::numeric is distinct from old_version+1 then
                raise exception 'invalid_object_version' using errcode = '22023';
            end if;
            select coalesce(jsonb_agg(x),'[]'::jsonb) into next_list from jsonb_array_elements(doc->list_key) x where x->>'id' <> object_id;
            if value <> 'null'::jsonb then next_list := next_list || jsonb_build_array(value); end if;
            doc := jsonb_set(doc,array[list_key],next_list);
            versions := jsonb_set(versions,array[scope],to_jsonb(old_version+1));
        end if;
    end loop;
    if structural then
        if p_project_version is distinct from (record.versions->>'project')::bigint then raise exception 'version_conflict' using errcode = '40001'; end if;
        versions := jsonb_set(versions,'{project}',to_jsonb((record.versions->>'project')::bigint+1));
    end if;
    perform ast_private.validate_project(doc);
    update public.ast_projects set document=doc, versions=mutation.versions, server_seq=server_seq+1 where id=p_project returning * into record;
    insert into public.ast_operations(project_id,op_id,actor_id,server_seq,payload,versions)
        values(p_project,p_op,auth.uid(),record.server_seq,jsonb_build_object('projectVersion',p_project_version,'changes',p_changes),versions) returning * into result;
    return result;
end;
$$;
-- Align the camera limits with the private validator vocabulary.
create or replace function public.ast_present(p_project uuid, p_session uuid, p_action text, p_phase uuid, p_camera jsonb) returns jsonb
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
        '{"type":"object","required":["center","zoom","bearing","pitch"],"additionalProperties":false,"properties":{"center":{"type":"array","min":2,"max":2,"items":{"type":"number","min":-180,"max":180}},"zoom":{"type":"number","min":0,"max":24},"bearing":{"type":"number","min":-180,"max":180},"pitch":{"type":"number","min":0,"max":85}}}'::jsonb) then
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

-- Root is a separately provisioned platform role. Project owners/admins cannot grant it.
create table ast_private.roots (user_id uuid primary key references auth.users(id) on delete cascade);
revoke all on ast_private.roots from public, anon, authenticated;
create function public.ast_is_root() returns boolean language sql stable security definer set search_path = '' as $$
    select exists(select 1 from ast_private.roots where user_id=auth.uid());
$$;
revoke all on function public.ast_is_root() from public,anon;
grant execute on function public.ast_is_root() to authenticated;

create table ast_private.catalog (
    id uuid primary key,
    site_id text not null,
    event_id text not null,
    edition text not null,
    title text not null,
    document jsonb not null,
    map jsonb not null,
    published_by uuid not null references auth.users(id),
    published_at timestamptz not null default now(),
    unique(site_id,event_id,edition)
);
revoke all on ast_private.catalog from public,anon,authenticated;

create function public.ast_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(x),'[]'::jsonb) from
        (select id,site_id,event_id,edition,title,published_at from ast_private.catalog order by published_at desc,id limit 100) x;
$$;
create function public.ast_catalog_package(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('project',document,'map',map) from ast_private.catalog where id=p_id;
$$;
revoke all on function public.ast_catalog(), public.ast_catalog_package(uuid) from public;
grant execute on function public.ast_catalog(), public.ast_catalog_package(uuid) to anon,authenticated;

create function public.ast_publish(p_id uuid, p_document jsonb, p_map jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w jsonb;
begin
    -- Row lock serializes publication with root revocation.
    perform 1 from ast_private.roots where user_id=auth.uid() for share;
    if not found then raise exception 'forbidden' using errcode = '42501'; end if;
    if p_id is null or p_document is null or p_map is null then raise exception 'invalid_package' using errcode = '22023'; end if;
    -- The collaborative map whitelist is not applicable to immutable bundled local areas.
    perform ast_private.validate_project(jsonb_set(p_document,'{mapPackageId}','"mahlwinkel"'::jsonb));
    w := p_document->'workspace';
    if w is null or btrim(w->>'siteId')='' or btrim(w->>'eventId')='' or btrim(w->>'edition')='' or btrim(w->>'source')=''
        or p_document->>'mapPackageId' is distinct from p_map->>'id'
        or coalesce(p_map->>'id','') !~ '^(mahlwinkel|benglen|local-[0-9a-f-]{36})$'
        or p_map->>'format' is distinct from 'as-tac-map' or p_map->>'formatVersion' is distinct from '1'
        or p_map->>'license' is distinct from 'ODbL 1.0' or p_map->>'attribution' is distinct from '© OpenStreetMap contributors'
        or jsonb_typeof(p_map->'data') is distinct from 'object' or octet_length(p_map::text)>30000000
        or coalesce(p_map->>'sha256','') !~ '^[0-9a-f]{64}$' then
        raise exception 'invalid_package' using errcode = '22023';
    end if;
    -- No update path: even root publishes a new edition rather than changing a downloaded one.
    insert into ast_private.catalog values(p_id,w->>'siteId',w->>'eventId',w->>'edition',p_document->>'name',p_document,p_map,auth.uid(),now());
    return p_id;
end;
$$;
revoke all on function public.ast_publish(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.ast_publish(uuid,jsonb,jsonb) to authenticated;
revoke all on all functions in schema ast_private from public,anon,authenticated;
commit;
