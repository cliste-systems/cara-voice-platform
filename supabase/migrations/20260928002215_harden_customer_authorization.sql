-- Customer-controlled rows must not carry billing, role, or storage authority.
-- Keep legitimate profile switching and business settings available.
create or replace function public.current_user_account_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.account_id
  from public.profiles p
  where p.id = auth.uid()
    and exists (
      select 1 from public.account_memberships m
      where m.user_id = p.id and m.account_id = p.account_id
    );
$$;

create or replace function public.user_can_access_organization(target_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organizations o
    join public.account_memberships m on m.account_id = o.account_id
    join public.profiles p on p.id = m.user_id and p.account_id = m.account_id
    where o.id = target_org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.current_user_organization_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select candidate.org_id
  from public.profiles p
  cross join lateral (select coalesce(p.active_organization_id, p.organization_id) as org_id) candidate
  where p.id = auth.uid()
    and public.user_can_access_organization(candidate.org_id);
$$;

create or replace function public.guard_customer_profile_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.account_id is distinct from old.account_id
       or new.organization_id is distinct from old.organization_id
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at then
      raise exception 'Profile authorization fields are server managed' using errcode = '42501';
    end if;
    if new.active_organization_id is not null
       and not public.user_can_access_organization(new.active_organization_id) then
      raise exception 'Organization membership required' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists a_guard_customer_profile_update on public.profiles;
create trigger a_guard_customer_profile_update before update on public.profiles
for each row execute function public.guard_customer_profile_update();

create or replace function public.guard_customer_organization_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or
    new.account_id is distinct from old.account_id or
    new.phone_number is distinct from old.phone_number or
    new.is_primary_location is distinct from old.is_primary_location or
    new.tier is distinct from old.tier or
    new.plan_tier is distinct from old.plan_tier or
    new.billing_period_start is distinct from old.billing_period_start or
    new.billing_interval is distinct from old.billing_interval or
    new.status is distinct from old.status or
    new.is_active is distinct from old.is_active or
    new.is_internal_test is distinct from old.is_internal_test or
    new.platform_customer_id is distinct from old.platform_customer_id or
    new.platform_subscription_id is distinct from old.platform_subscription_id or
    new.stripe_account_id is distinct from old.stripe_account_id or
    new.stripe_charges_enabled is distinct from old.stripe_charges_enabled or
    new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled or
    new.stripe_details_submitted is distinct from old.stripe_details_submitted or
    new.application_fee_bps is distinct from old.application_fee_bps or
    new.setup_fee_paid_cents is distinct from old.setup_fee_paid_cents or
    new.launch_tier is distinct from old.launch_tier or
    new.launch_status is distinct from old.launch_status or
    new.launch_scheduled_at is distinct from old.launch_scheduled_at or
    new.launch_specialist_id is distinct from old.launch_specialist_id or
    new.suspended_at is distinct from old.suspended_at or
    new.suspended_reason is distinct from old.suspended_reason
  ) then
    raise exception 'Organization billing and operational fields are server managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists zz_guard_customer_organization_update on public.organizations;
create trigger zz_guard_customer_organization_update before update on public.organizations
for each row execute function public.guard_customer_organization_update();

create or replace function public.guard_customer_account_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or
    new.plan_tier is distinct from old.plan_tier or
    new.billing_period_start is distinct from old.billing_period_start or
    new.billing_interval is distinct from old.billing_interval or
    new.status is distinct from old.status or
    new.platform_customer_id is distinct from old.platform_customer_id or
    new.platform_subscription_id is distinct from old.platform_subscription_id or
    new.application_fee_bps is distinct from old.application_fee_bps or
    new.setup_fee_paid_cents is distinct from old.setup_fee_paid_cents or
    new.launch_tier is distinct from old.launch_tier or
    new.launch_status is distinct from old.launch_status or
    new.launch_scheduled_at is distinct from old.launch_scheduled_at or
    new.launch_specialist_id is distinct from old.launch_specialist_id or
    new.suspended_at is distinct from old.suspended_at or
    new.suspended_reason is distinct from old.suspended_reason
  ) then
    raise exception 'Account billing and operational fields are server managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_customer_account_update on public.accounts;
create trigger guard_customer_account_update before update on public.accounts
for each row execute function public.guard_customer_account_update();

create or replace function public.guard_customer_business_file_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or
    new.organization_id is distinct from old.organization_id or
    new.storage_path is distinct from old.storage_path or
    new.created_at is distinct from old.created_at
  ) then
    raise exception 'Business file identity and storage path are server managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_customer_business_file_update on public.business_files;
create trigger guard_customer_business_file_update before update on public.business_files
for each row execute function public.guard_customer_business_file_update();

-- These RPCs are for backend calls only. PUBLIC grants are inherited by anon.
revoke execute on function public.increment_caller_abuse_hit(uuid, text) from public, anon, authenticated;
revoke execute on function public.invalidate_store_transfer_verification(uuid) from public, anon, authenticated;
revoke execute on function public.set_store_transfer_verification_pending(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.stamp_store_transfer_verified(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_caller_abuse_hit(uuid, text) to service_role;
grant execute on function public.invalidate_store_transfer_verification(uuid) to service_role;
grant execute on function public.set_store_transfer_verification_pending(uuid, boolean) to service_role;
grant execute on function public.stamp_store_transfer_verified(uuid, text) to service_role;
