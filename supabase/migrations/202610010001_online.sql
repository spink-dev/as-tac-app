begin;
-- AS-TAC online foundation. No direct client writes; every mutation is a guarded RPC.
create schema if not exists ast_private;
revoke all on schema ast_private from public, anon, authenticated;

create table public.ast_projects (
    id uuid primary key,
    owner_id uuid not null references auth.users(id),
    document jsonb not null,
    server_seq bigint not null default 0 check (server_seq >= 0),
    versions jsonb not null default '{"project":1}',
    created_at timestamptz not null default now()
);
create table public.ast_memberships (
    project_id uuid not null references public.ast_projects(id) on delete cascade,
    user_id uuid not null references auth.users(id),
    role text not null check (role in ('owner', 'admin', 'viewer')),
    primary key (project_id, user_id)
);
create index ast_memberships_user on public.ast_memberships(user_id);
create table public.ast_operations (
    project_id uuid not null references public.ast_projects(id) on delete cascade,
    op_id uuid not null,
    actor_id uuid not null references auth.users(id),
    server_seq bigint not null,
    payload jsonb not null,
    versions jsonb not null,
    created_at timestamptz not null default now(),
    primary key(project_id, op_id),
    unique(project_id, server_seq)
);
alter table public.ast_projects enable row level security;
alter table public.ast_memberships enable row level security;
alter table public.ast_operations enable row level security;
revoke all on public.ast_projects, public.ast_memberships, public.ast_operations from public, anon, authenticated;
grant select on public.ast_projects, public.ast_memberships, public.ast_operations to authenticated;

create function public.ast_role(p_project uuid) returns text
language sql stable security definer set search_path = '' as $$
    select role from public.ast_memberships where project_id = p_project and user_id = auth.uid();
$$;
revoke all on function public.ast_role(uuid) from public, anon;
grant execute on function public.ast_role(uuid) to authenticated;
create policy ast_project_read on public.ast_projects for select to authenticated using (public.ast_role(id) is not null);
create policy ast_members_read on public.ast_memberships for select to authenticated using (public.ast_role(project_id) is not null);
create policy ast_operations_read on public.ast_operations for select to authenticated using (public.ast_role(project_id) is not null);

-- Small private schema validator. Only our static schema is passed to it, never client schemas.
create function ast_private.matches(v jsonb, s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; child jsonb; n numeric;
begin
    if v is null then return false; end if;
    if s ? 'anyOf' then
        for child in select value from jsonb_array_elements(s->'anyOf') loop
            if ast_private.matches(v, child) then return true; end if;
        end loop;
        return false;
    end if;
    if s ? 'enum' and not (s->'enum' @> jsonb_build_array(v)) then return false; end if;
    if s ? 'type' and jsonb_typeof(v) <> s->>'type' then return false; end if;
    case jsonb_typeof(v)
    when 'object' then
        for k in select jsonb_object_keys(v) loop
            if not (s->'properties' ? k) or not ast_private.matches(v->k, s->'properties'->k) then return false; end if;
        end loop;
        for k in select jsonb_array_elements_text(coalesce(s->'required','[]')) loop
            if not (v ? k) then return false; end if;
        end loop;
    when 'array' then
        if jsonb_array_length(v) < coalesce((s->>'min')::int,0) or jsonb_array_length(v) > (s->>'max')::int then return false; end if;
        for child in select value from jsonb_array_elements(v) loop
            if not ast_private.matches(child,s->'items') then return false; end if;
        end loop;
        if s->>'unique' = 'true' and (select count(*) <> count(distinct value) from jsonb_array_elements(v)) then return false; end if;
    when 'string' then
        if length(v #>> '{}') > (s->>'max')::int or (s->>'nonempty' = 'true' and btrim(v #>> '{}') = '')
            or (s ? 'pattern' and not (v #>> '{}' ~ (s->>'pattern'))) then return false; end if;
    when 'number' then
        n := (v #>> '{}')::numeric;
        if n < (s->>'min')::numeric or n > (s->>'max')::numeric or (s->>'integer' = 'true' and n <> trunc(n)) then return false; end if;
    else null;
    end case;
    return true;
end;
$$;

create function ast_private.project_schema() returns jsonb language sql immutable set search_path = '' as $schema$
select '{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "max": 36,
      "nonempty": false,
      "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    },
    "schemaVersion": {
      "type": "number",
      "enum": [
        1
      ]
    },
    "name": {
      "type": "string",
      "max": 120,
      "nonempty": true
    },
    "mapPackageId": {
      "type": "string",
      "enum": [
        "benglen",
        "mahlwinkel"
      ]
    },
    "teams": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 36,
            "nonempty": false,
            "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
          },
          "name": {
            "type": "string",
            "max": 120,
            "nonempty": true
          },
          "shortLabel": {
            "type": "string",
            "max": 12,
            "nonempty": true
          },
          "colour": {
            "type": "string",
            "max": 7,
            "nonempty": false,
            "pattern": "^#[0-9a-fA-F]{6}$"
          }
        },
        "required": [
          "id",
          "name",
          "shortLabel",
          "colour"
        ]
      },
      "min": 0,
      "max": 100
    },
    "phases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 36,
            "nonempty": false,
            "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
          },
          "order": {
            "type": "number",
            "min": 0,
            "max": 9007199254740991,
            "integer": true
          },
          "title": {
            "type": "string",
            "max": 120,
            "nonempty": true
          },
          "notes": {
            "type": "string",
            "max": 10000,
            "nonempty": false
          },
          "camera": {
            "anyOf": [
              {
                "type": "null"
              },
              {
                "type": "object",
                "properties": {
                  "center": {
                    "type": "array",
                    "items": {
                      "type": "number",
                      "min": -180,
                      "max": 180,
                      "integer": false
                    },
                    "min": 2,
                    "max": 2
                  },
                  "zoom": {
                    "type": "number",
                    "min": 0,
                    "max": 24,
                    "integer": false
                  },
                  "bearing": {
                    "type": "number",
                    "min": -360,
                    "max": 360,
                    "integer": false
                  },
                  "pitch": {
                    "type": "number",
                    "min": 0,
                    "max": 85,
                    "integer": false
                  }
                },
                "required": [
                  "center",
                  "zoom",
                  "bearing",
                  "pitch"
                ]
              }
            ]
          },
          "visibleElementIds": {
            "type": "array",
            "items": {
              "type": "string",
              "max": 36,
              "nonempty": false,
              "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
            },
            "min": 0,
            "max": 500,
            "unique": true
          }
        },
        "required": [
          "id",
          "order",
          "title",
          "notes",
          "camera",
          "visibleElementIds"
        ]
      },
      "min": 0,
      "max": 100
    },
    "elements": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 36,
            "nonempty": false,
            "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
          },
          "projectId": {
            "type": "string",
            "max": 36,
            "nonempty": false,
            "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
          },
          "type": {
            "type": "string",
            "enum": [
              "point",
              "text",
              "line",
              "freehand",
              "polygon",
              "circle"
            ]
          },
          "geometry": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "Point"
                    ]
                  },
                  "coordinates": {
                    "type": "array",
                    "items": {
                      "type": "number",
                      "min": -180,
                      "max": 180,
                      "integer": false
                    },
                    "min": 2,
                    "max": 2
                  }
                },
                "required": [
                  "type",
                  "coordinates"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "LineString"
                    ]
                  },
                  "coordinates": {
                    "type": "array",
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "number",
                        "min": -180,
                        "max": 180,
                        "integer": false
                      },
                      "min": 2,
                      "max": 2
                    },
                    "min": 2,
                    "max": 5000
                  }
                },
                "required": [
                  "type",
                  "coordinates"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "Polygon"
                    ]
                  },
                  "coordinates": {
                    "type": "array",
                    "items": {
                      "type": "array",
                      "items": {
                        "type": "array",
                        "items": {
                          "type": "number",
                          "min": -180,
                          "max": 180,
                          "integer": false
                        },
                        "min": 2,
                        "max": 2
                      },
                      "min": 4,
                      "max": 5000
                    },
                    "min": 1,
                    "max": 100
                  }
                },
                "required": [
                  "type",
                  "coordinates"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "Circle"
                    ]
                  },
                  "center": {
                    "type": "array",
                    "items": {
                      "type": "number",
                      "min": -180,
                      "max": 180,
                      "integer": false
                    },
                    "min": 2,
                    "max": 2
                  },
                  "radiusMeters": {
                    "type": "number",
                    "min": 0.1,
                    "max": 100000,
                    "integer": false
                  }
                },
                "required": [
                  "type",
                  "center",
                  "radiusMeters"
                ]
              }
            ]
          },
          "label": {
            "type": "string",
            "max": 200,
            "nonempty": false
          },
          "notes": {
            "type": "string",
            "max": 10000,
            "nonempty": false
          },
          "teamId": {
            "type": "string",
            "max": 36,
            "nonempty": false,
            "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
          },
          "phaseIds": {
            "type": "array",
            "items": {
              "type": "string",
              "max": 36,
              "nonempty": false,
              "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
            },
            "min": 0,
            "max": 500,
            "unique": true
          },
          "style": {
            "type": "object",
            "properties": {
              "colour": {
                "type": "string",
                "max": 7,
                "nonempty": false,
                "pattern": "^#[0-9a-fA-F]{6}$"
              },
              "width": {
                "type": "number",
                "min": 1,
                "max": 20,
                "integer": false
              },
              "opacity": {
                "type": "number",
                "min": 0,
                "max": 1,
                "integer": false
              }
            },
            "required": [
              "colour",
              "width",
              "opacity"
            ]
          },
          "version": {
            "type": "number",
            "min": 1,
            "max": 9007199254740991,
            "integer": true
          },
          "deletedAt": {
            "type": "string",
            "max": 24,
            "nonempty": false,
            "pattern": "^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$"
          }
        },
        "required": [
          "id",
          "projectId",
          "type",
          "geometry",
          "label",
          "notes",
          "phaseIds",
          "style",
          "version"
        ]
      },
      "min": 0,
      "max": 500
    }
  },
  "required": [
    "id",
    "schemaVersion",
    "name",
    "mapPackageId",
    "teams",
    "phases",
    "elements"
  ]
}'::jsonb;
$schema$;

create function ast_private.validate_project(doc jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare item jsonb; geom jsonb; line jsonb; point jsonb; coords jsonb; vertices int := 0;
begin
    if octet_length(doc::text) > 4194304 or not ast_private.matches(doc, ast_private.project_schema()) then
        raise exception 'invalid_project' using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements((doc->'teams') || (doc->'phases') || (doc->'elements')))
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

create function public.ast_create_project(p_id uuid, p_name text, p_map text) returns public.ast_projects
language plpgsql security definer set search_path = '' as $$
declare doc jsonb; result public.ast_projects;
begin
    if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
    doc := jsonb_build_object('id',p_id,'schemaVersion',1,'name',p_name,'mapPackageId',p_map,'teams','[]'::jsonb,'phases','[]'::jsonb,'elements','[]'::jsonb);
    perform ast_private.validate_project(doc);
    insert into public.ast_projects(id,owner_id,document) values(p_id,auth.uid(),doc) returning * into result;
    insert into public.ast_memberships values(p_id,auth.uid(),'owner');
    return result;
end;
$$;

create function public.ast_set_member(p_project uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare owner uuid;
begin
    select owner_id into owner from public.ast_projects where id = p_project for update;
    if owner is null or owner is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
    if p_user = owner or (p_role is not null and p_role not in ('admin','viewer')) then raise exception 'invalid_role' using errcode = '22023'; end if;
    if p_role is null then
        delete from public.ast_memberships where project_id = p_project and user_id = p_user;
    else
        insert into public.ast_memberships values(p_project,p_user,p_role) on conflict(project_id,user_id) do update set role=excluded.role;
    end if;
end;
$$;

-- Batches are atomic. Element-only changes use per-element versions; structural edits also CAS project scope.
create function public.ast_apply(p_project uuid, p_op uuid, p_project_version bigint, p_changes jsonb) returns public.ast_operations
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
            if object_id <> p_project::text or jsonb_typeof(value) <> 'object' or (value - 'name' - 'mapPackageId') <> '{}'::jsonb then raise exception 'invalid_metadata' using errcode = '22023'; end if;
            doc := doc || value;
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
revoke all on all functions in schema ast_private from public, anon, authenticated;
revoke all on function public.ast_create_project(uuid,text,text), public.ast_set_member(uuid,uuid,text), public.ast_apply(uuid,uuid,bigint,jsonb) from public, anon;
grant execute on function public.ast_create_project(uuid,text,text), public.ast_set_member(uuid,uuid,text), public.ast_apply(uuid,uuid,bigint,jsonb) to authenticated;
-- No Storage bucket or Broadcast channel is created. Both remain closed for this foundation.

commit;
