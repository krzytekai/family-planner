-- Native Android push delivery for canonical public.notifications.
-- Device registration is client-facing through narrow RPCs; delivery internals stay private.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.notification_devices
  add column if not exists installation_id uuid;

create unique index if not exists notification_devices_provider_installation_unique
  on public.notification_devices(provider, installation_id)
  where installation_id is not null;

create index if not exists notification_devices_active_user_idx
  on public.notification_devices(user_id, provider)
  where disabled_at is null;

create table if not exists private.notification_device_credentials (
  device_id uuid primary key references public.notification_devices(id) on delete cascade,
  installation_secret_hash bytea not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint notification_device_credentials_sha256_length_check
    check (pg_catalog.octet_length(installation_secret_hash) = 32)
);

alter table private.notification_device_credentials enable row level security;
revoke all on private.notification_device_credentials from public, anon, authenticated;

create or replace function private.secure_hash_equal(left_hash bytea, right_hash bytea)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  difference integer := 0;
  byte_index integer;
begin
  if pg_catalog.octet_length(left_hash) <> 32
    or pg_catalog.octet_length(right_hash) <> 32 then
    return false;
  end if;

  for byte_index in 0..31 loop
    difference := difference | (pg_catalog.get_byte(left_hash, byte_index) # pg_catalog.get_byte(right_hash, byte_index));
  end loop;
  return difference = 0;
end;
$$;
revoke all on function private.secure_hash_equal(bytea,bytea) from public, anon, authenticated;

-- The RPC may transfer a token/installation to the currently authenticated account.
-- Direct table writes are revoked below, and the trigger still rejects any other owner.
create or replace function private.prepare_notification_device_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
    and new.user_id is distinct from (select auth.uid()) then
    raise exception 'device owner mismatch';
  end if;

  new.push_token := pg_catalog.btrim(new.push_token);
  new.device_label := nullif(pg_catalog.btrim(new.device_label), '');
  new.app_version := nullif(pg_catalog.btrim(new.app_version), '');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.prepare_notification_device_write() from public, anon, authenticated;

create or replace function public.register_notification_device(
  device_installation_id uuid,
  device_installation_secret text,
  device_push_token text,
  device_app_version text default null,
  device_label_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_token text := pg_catalog.btrim(device_push_token);
  provided_secret_hash bytea;
  stored_secret_hash bytea;
  installation_device_id uuid;
  token_device_id uuid;
  target_device_id uuid;
  installation_lock_key bigint;
  token_lock_key bigint;
  matched_device record;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;
  if device_installation_id is null then
    raise exception 'installation id is required';
  end if;
  if device_installation_secret is null
    or pg_catalog.char_length(device_installation_secret) < 43
    or pg_catalog.char_length(device_installation_secret) > 128
    or device_installation_secret !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'installation ownership verification failed';
  end if;
  if normalized_token is null or pg_catalog.char_length(normalized_token) < 16
    or pg_catalog.char_length(normalized_token) > 4096 then
    raise exception 'invalid push token';
  end if;

  provided_secret_hash := pg_catalog.sha256(
    pg_catalog.convert_to(device_installation_secret, 'UTF8')
  );

  -- Transaction-scoped locks serialize this installation and token without locking the whole table.
  installation_lock_key := pg_catalog.hashtextextended(
    'notification-device-installation:' || device_installation_id::text,
    0
  );
  token_lock_key := pg_catalog.hashtextextended(
    'notification-device-token:' || normalized_token,
    0
  );
  if installation_lock_key <= token_lock_key then
    perform pg_catalog.pg_advisory_xact_lock(installation_lock_key);
    if installation_lock_key <> token_lock_key then
      perform pg_catalog.pg_advisory_xact_lock(token_lock_key);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(token_lock_key);
    perform pg_catalog.pg_advisory_xact_lock(installation_lock_key);
  end if;

  -- Lock both possible rows in deterministic primary-key order to avoid cross-merge deadlocks.
  for matched_device in
    select d.id, d.installation_id, d.push_token
    from public.notification_devices d
    where d.provider = 'fcm'
      and (d.installation_id = device_installation_id or d.push_token = normalized_token)
    order by d.id
    for update
  loop
    if matched_device.installation_id = device_installation_id then
      installation_device_id := matched_device.id;
    end if;
    if matched_device.push_token = normalized_token then
      token_device_id := matched_device.id;
    end if;
  end loop;

  if installation_device_id is null then
    -- A token already attached to any other record is not proof of this new installation.
    if token_device_id is not null then
      raise exception 'installation ownership verification failed';
    end if;

    insert into public.notification_devices(
      user_id, platform, provider, push_token, installation_id,
      device_label, app_version, last_seen_at, disabled_at
    ) values (
      current_user_id, 'android', 'fcm', normalized_token, device_installation_id,
      device_label_value, device_app_version, pg_catalog.now(), null
    )
    returning id into target_device_id;

    insert into private.notification_device_credentials(
      device_id, installation_secret_hash
    ) values (
      target_device_id, provided_secret_hash
    );

    return target_device_id;
  end if;

  select c.installation_secret_hash into stored_secret_hash
  from private.notification_device_credentials c
  where c.device_id = installation_device_id
  for update;

  if stored_secret_hash is null
    or not private.secure_hash_equal(stored_secret_hash, provided_secret_hash) then
    raise exception 'installation ownership verification failed';
  end if;

  -- Proof for installation A never authorizes taking over a distinct token record B.
  if token_device_id is not null and token_device_id <> installation_device_id then
    raise exception 'installation ownership verification failed';
  end if;

  update public.notification_devices
  set user_id = current_user_id,
      platform = 'android',
      provider = 'fcm',
      push_token = normalized_token,
      installation_id = device_installation_id,
      device_label = device_label_value,
      app_version = device_app_version,
      last_seen_at = pg_catalog.now(),
      disabled_at = null
  where id = installation_device_id
  returning id into target_device_id;

  update private.notification_device_credentials
  set updated_at = pg_catalog.now()
  where device_id = target_device_id;

  return target_device_id;
end;
$$;
revoke all on function public.register_notification_device(uuid,text,text,text,text) from public, anon;
grant execute on function public.register_notification_device(uuid,text,text,text,text) to authenticated;

create or replace function public.disable_notification_device(device_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  update public.notification_devices d
  set disabled_at = coalesce(d.disabled_at, pg_catalog.now()),
      last_seen_at = pg_catalog.now()
  where d.installation_id = device_installation_id
    and d.provider = 'fcm'
    and d.user_id = (select auth.uid());

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;
revoke all on function public.disable_notification_device(uuid) from public, anon;
grant execute on function public.disable_notification_device(uuid) to authenticated;

-- Registration ownership changes must only happen through the guarded RPCs.
revoke insert, update, delete on public.notification_devices from anon, authenticated;

create table if not exists private.notification_push_deliveries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid not null references public.notification_devices(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint notification_push_deliveries_notification_device_unique
    unique(notification_id, device_id),
  constraint notification_push_deliveries_state_check check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index if not exists notification_push_deliveries_pending_idx
  on private.notification_push_deliveries(next_attempt_at, created_at)
  where status = 'pending';

create index if not exists notification_push_deliveries_processing_idx
  on private.notification_push_deliveries(claimed_at)
  where status = 'processing';

alter table private.notification_push_deliveries enable row level security;
revoke all on private.notification_push_deliveries from public, anon, authenticated;

create or replace function private.enqueue_notification_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.notification_push_enabled(new.family_id, new.recipient_user_id) then
    insert into private.notification_push_deliveries(notification_id, device_id)
    select new.id, d.id
    from public.notification_devices d
    where d.user_id = new.recipient_user_id
      and d.platform = 'android'
      and d.provider = 'fcm'
      and d.disabled_at is null
    on conflict (notification_id, device_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.enqueue_notification_push_deliveries() from public, anon, authenticated;

drop trigger if exists enqueue_notification_push_deliveries on public.notifications;
create trigger enqueue_notification_push_deliveries
after insert on public.notifications
for each row execute function private.enqueue_notification_push_deliveries();

create or replace function public.claim_notification_push_deliveries(batch_size integer default 100)
returns table (
  delivery_id uuid,
  notification_id uuid,
  device_id uuid,
  push_token text,
  attempt_count integer,
  family_id uuid,
  recipient_user_id uuid,
  notification_type text,
  title text,
  body text,
  source_type text,
  source_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.notification_push_deliveries d
  set status = case when d.attempt_count >= 6 then 'failed' else 'pending' end,
      next_attempt_at = case when d.attempt_count >= 6 then d.next_attempt_at else pg_catalog.now() end,
      claimed_at = null,
      last_error = case when d.attempt_count >= 6 then 'claim_timeout_max_attempts' else 'claim_timeout' end,
      updated_at = pg_catalog.now()
  where d.status = 'processing'
    and d.claimed_at < pg_catalog.now() - interval '10 minutes';

  update private.notification_push_deliveries d
  set status = 'cancelled',
      claimed_at = null,
      last_error = 'delivery_no_longer_allowed',
      updated_at = pg_catalog.now()
  from public.notifications n, public.notification_devices nd
  where d.notification_id = n.id
    and d.device_id = nd.id
    and d.status = 'pending'
    and d.next_attempt_at <= pg_catalog.now()
    and (
      nd.disabled_at is not null
      or nd.user_id <> n.recipient_user_id
      or not exists (
        select 1 from public.family_members fm
        where fm.family_id = n.family_id
          and fm.user_id = n.recipient_user_id
          and fm.status = 'active'
      )
      or not private.notification_push_enabled(n.family_id, n.recipient_user_id)
    );

  return query
  with candidates as (
    select d.id
    from private.notification_push_deliveries d
    where d.status = 'pending'
      and d.next_attempt_at <= pg_catalog.now()
      and d.attempt_count < 6
    order by d.next_attempt_at, d.created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 100), 1000))
  ), claimed as (
    update private.notification_push_deliveries d
    set status = 'processing',
        attempt_count = d.attempt_count + 1,
        claimed_at = pg_catalog.now(),
        last_error = null,
        updated_at = pg_catalog.now()
    from candidates c
    where d.id = c.id
    returning d.*
  )
  select c.id, n.id, nd.id, nd.push_token, c.attempt_count,
         n.family_id, n.recipient_user_id, n.notification_type,
         n.title, n.body, n.source_type, n.source_id
  from claimed c
  join public.notifications n on n.id = c.notification_id
  join public.notification_devices nd on nd.id = c.device_id;
end;
$$;
revoke all on function public.claim_notification_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_push_deliveries(integer) to service_role;

create or replace function public.complete_notification_push_delivery(
  target_delivery_id uuid,
  target_provider_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected_rows integer;
begin
  update private.notification_push_deliveries d
  set status = 'sent',
      sent_at = pg_catalog.now(),
      claimed_at = null,
      provider_message_id = nullif(pg_catalog.left(target_provider_message_id, 500), ''),
      last_error = null,
      updated_at = pg_catalog.now()
  where d.id = target_delivery_id and d.status = 'processing';
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;
revoke all on function public.complete_notification_push_delivery(uuid,text) from public, anon, authenticated;
grant execute on function public.complete_notification_push_delivery(uuid,text) to service_role;

create or replace function public.fail_notification_push_delivery(
  target_delivery_id uuid,
  target_error_code text,
  permanent_failure boolean,
  retry_after_seconds integer default 60,
  disable_device boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
  target_device_id uuid;
begin
  select d.device_id into target_device_id
  from private.notification_push_deliveries d
  where d.id = target_delivery_id and d.status = 'processing'
  for update;

  if target_device_id is null then
    return false;
  end if;

  update private.notification_push_deliveries d
  set status = case when permanent_failure or d.attempt_count >= 6 then 'failed' else 'pending' end,
      next_attempt_at = case
        when permanent_failure or d.attempt_count >= 6 then d.next_attempt_at
        else pg_catalog.now() + pg_catalog.make_interval(secs => greatest(30, least(coalesce(retry_after_seconds, 60), 21600)))
      end,
      claimed_at = null,
      last_error = nullif(pg_catalog.left(target_error_code, 500), ''),
      updated_at = pg_catalog.now()
  where d.id = target_delivery_id and d.status = 'processing';
  get diagnostics affected_rows = row_count;

  if affected_rows = 1 and disable_device then
    update public.notification_devices
    set disabled_at = coalesce(disabled_at, pg_catalog.now())
    where id = target_device_id;
  end if;

  return affected_rows = 1;
end;
$$;
revoke all on function public.fail_notification_push_delivery(uuid,text,boolean,integer,boolean) from public, anon, authenticated;
grant execute on function public.fail_notification_push_delivery(uuid,text,boolean,integer,boolean) to service_role;

notify pgrst, 'reload schema';
