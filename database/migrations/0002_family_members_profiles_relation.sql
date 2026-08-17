-- Backfill profiles for existing family members and expose the relationship to PostgREST.

insert into public.profiles (id, email, display_name)
select
  auth_user.id,
  auth_user.email,
  coalesce(
    auth_user.raw_user_meta_data ->> 'display_name',
    split_part(coalesce(auth_user.email, 'Użytkownik'), '@', 1)
  )
from auth.users as auth_user
where exists (
  select 1
  from public.family_members as family_member
  where family_member.user_id = auth_user.id
)
on conflict (id) do nothing;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'family_members_user_id_profiles_fkey'
      and conrelid = 'public.family_members'::regclass
  ) then
    alter table public.family_members
      add constraint family_members_user_id_profiles_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

notify pgrst, 'reload schema';
