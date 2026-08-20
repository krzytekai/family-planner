-- Schedule the deployed push dispatcher without storing credentials in migrations.
-- The required push_dispatcher_url and push_worker_secret values must already
-- exist in Supabase Vault before this migration is applied.

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'push_dispatcher_url'
  ) then
    raise exception 'Required Vault secret push_dispatcher_url is missing';
  end if;

  if not exists (
    select 1
    from vault.secrets
    where name = 'push_worker_secret'
  ) then
    raise exception 'Required Vault secret push_worker_secret is missing';
  end if;
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'push-dispatcher-every-minute'
    order by jobid
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'push-dispatcher-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'push_dispatcher_url'
    ),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'push_worker_secret'
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $job$
);
