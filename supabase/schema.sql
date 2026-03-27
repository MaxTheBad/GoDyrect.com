-- GoDyrect initial schema
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  full_name text,
  phone text,
  role text check (role in ('buyer','seller','broker','not_sure')) default 'buyer',
  marketing_opt_in boolean default false,
  terms_accepted_at timestamptz,
  avatar_url text,
  bio text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique,
  description text,
  category text check (category in ('established','asset_sale','real_estate','startup')),
  start_date date,
  annual_revenue numeric(14,2),
  annual_profit numeric(14,2),
  default_asking_price numeric(14,2),
  city text,
  state text,
  country text,
  county text,
  keywords text[] default '{}',
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.business_memberships (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner',
  is_admin boolean not null default false,
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now() not null,
  unique (business_id, user_id)
);

create index if not exists idx_business_memberships_user on public.business_memberships(user_id);
create index if not exists idx_business_memberships_business on public.business_memberships(business_id);

create type public.listing_category as enum (
  'established',
  'asset_sale',
  'real_estate',
  'startup'
);

create table if not exists public.listings (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  title text not null,
  description text,
  category public.listing_category not null,
  lister_role text,
  business_age_years int,
  asking_price numeric(14,2) not null,
  annual_revenue numeric(14,2),
  annual_profit numeric(14,2),
  city text,
  state text,
  country text,
  lat double precision,
  lng double precision,
  is_active boolean default true not null,
  is_sold boolean default false not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_listings_category on public.listings(category);
create index if not exists idx_listings_price on public.listings(asking_price);
create index if not exists idx_listings_age on public.listings(business_age_years);
create index if not exists idx_listings_geo on public.listings(lat, lng);
create index if not exists idx_listings_business on public.listings(business_id);

create table if not exists public.listing_media (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  media_type text check (media_type in ('image','video')) not null,
  url text not null,
  thumbnail_url text,
  sort_order int default 0,
  created_at timestamptz default now() not null
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz default now() not null,
  primary key (user_id, listing_id)
);

create table if not exists public.user_follows (
  follower_user_id uuid not null references public.profiles(id) on delete cascade,
  followed_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now() not null,
  primary key (follower_user_id, followed_user_id),
  check (follower_user_id <> followed_user_id)
);

create table if not exists public.business_follows (
  follower_user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz default now() not null,
  primary key (follower_user_id, business_id)
);

create index if not exists idx_user_follows_followed on public.user_follows(followed_user_id);
create index if not exists idx_business_follows_business on public.business_follows(business_id);

create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  created_at timestamptz default now() not null,
  unique (buyer_id, seller_id, listing_id)
);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now() not null
);

-- Updated-at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at
before update on public.listings
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_businesses_updated_at on public.businesses;
create trigger trg_businesses_updated_at
before update on public.businesses
for each row execute procedure public.set_updated_at();

-- Auto-create profile row for every auth user (prevents listings FK errors)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role, marketing_opt_in, terms_accepted_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.raw_user_meta_data->>'phone', null),
    coalesce(new.raw_user_meta_data->>'role', 'buyer'),
    coalesce((new.raw_user_meta_data->>'marketing_opt_in')::boolean, false),
    coalesce((new.raw_user_meta_data->>'terms_accepted_at')::timestamptz, now())
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        role = excluded.role,
        marketing_opt_in = excluded.marketing_opt_in,
        terms_accepted_at = excluded.terms_accepted_at;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;
alter table public.listings enable row level security;
alter table public.listing_media enable row level security;
alter table public.favorites enable row level security;
alter table public.user_follows enable row level security;
alter table public.business_follows enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Policies: profiles
create policy "profiles are public readable" on public.profiles
for select using (true);
create policy "users can upsert own profile" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

-- Policies: businesses
drop policy if exists "businesses public readable" on public.businesses;
create policy "businesses public readable" on public.businesses
for select using (status = 'approved');
drop policy if exists "businesses creator manages" on public.businesses;
create policy "businesses creator manages" on public.businesses
for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- Helpers to avoid RLS recursion on business_memberships
create or replace function public.is_business_member(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.business_memberships bm
    where bm.business_id = _business_id
      and bm.user_id = _user_id
      and bm.status = 'approved'
  );
$$;

create or replace function public.is_business_admin(_business_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.business_memberships bm
    where bm.business_id = _business_id
      and bm.user_id = _user_id
      and bm.status = 'approved'
      and bm.is_admin = true
  );
$$;

-- Policies: business memberships
drop policy if exists "members read memberships" on public.business_memberships;
create policy "members read memberships" on public.business_memberships
for select using (
  auth.uid() = user_id
  or public.is_business_member(business_id, auth.uid())
);

drop policy if exists "creator seeds own membership" on public.business_memberships;
create policy "creator seeds own membership" on public.business_memberships
for insert with check (
  auth.uid() = user_id
  and exists(
    select 1 from public.businesses b
    where b.id = business_memberships.business_id
      and b.created_by = auth.uid()
  )
);

drop policy if exists "admins manage memberships" on public.business_memberships;
create policy "admins manage memberships" on public.business_memberships
for all using (public.is_business_admin(business_id, auth.uid()))
with check (public.is_business_admin(business_id, auth.uid()));

-- Policies: listings
create policy "listings readable" on public.listings
for select using (is_active = true);
create policy "seller manages own listings" on public.listings
for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

-- Policies: media
create policy "media readable" on public.listing_media
for select using (true);
create policy "seller manages own media" on public.listing_media
for all using (
  exists(select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
) with check (
  exists(select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
);

-- Policies: favorites
create policy "users read own favorites" on public.favorites
for select using (auth.uid() = user_id);
create policy "users manage own favorites" on public.favorites
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Policies: follows
drop policy if exists "users read own follows" on public.user_follows;
create policy "users read own follows" on public.user_follows
for select using (auth.uid() = follower_user_id);
drop policy if exists "users manage own follows" on public.user_follows;
create policy "users manage own follows" on public.user_follows
for all using (auth.uid() = follower_user_id) with check (auth.uid() = follower_user_id);

drop policy if exists "users read own business follows" on public.business_follows;
create policy "users read own business follows" on public.business_follows
for select using (auth.uid() = follower_user_id);
drop policy if exists "users manage own business follows" on public.business_follows;
create policy "users manage own business follows" on public.business_follows
for all using (auth.uid() = follower_user_id) with check (auth.uid() = follower_user_id);

-- Policies: conversations/messages
create policy "participants can read conversations" on public.conversations
for select using (auth.uid() in (buyer_id, seller_id));
create policy "participants can create conversations" on public.conversations
for insert with check (auth.uid() in (buyer_id, seller_id));

create policy "participants read messages" on public.messages
for select using (
  exists(select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
);
create policy "participants send messages" on public.messages
for insert with check (
  auth.uid() = sender_id and
  exists(select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
);

-- Ensure profile fields exist for existing projects
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists marketing_opt_in boolean default false;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles alter column role set default 'buyer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('buyer','seller','broker','not_sure'));

-- Search support (name/category/keywords only, not description)
alter table public.businesses add column if not exists description text;
alter table public.businesses add column if not exists category text;
alter table public.businesses add column if not exists start_date date;
alter table public.businesses add column if not exists annual_revenue numeric(14,2);
alter table public.businesses add column if not exists annual_profit numeric(14,2);
alter table public.businesses add column if not exists default_asking_price numeric(14,2);
alter table public.businesses add column if not exists city text;
alter table public.businesses add column if not exists state text;
alter table public.businesses add column if not exists country text;
alter table public.businesses add column if not exists county text;
alter table public.businesses add column if not exists keywords text[] default '{}';
alter table public.businesses drop constraint if exists businesses_category_check;
alter table public.businesses add constraint businesses_category_check check (category in ('established','asset_sale','real_estate','startup') or category is null);

alter table public.listings
  add column if not exists business_id uuid references public.businesses(id) on delete set null;
alter table public.listings
  add column if not exists lister_role text;
alter table public.listings
  add column if not exists keywords text[] default '{}';

create index if not exists idx_listings_keywords_gin on public.listings using gin (keywords);
create index if not exists idx_listings_title_trgm on public.listings using gin (title gin_trgm_ops);

-- Supabase Storage buckets
insert into storage.buckets (id, name, public)
values ('listing-media', 'listing-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

-- Storage policies
-- Note: do not run ALTER TABLE on storage.objects; managed by Supabase

drop policy if exists "listing media public read" on storage.objects;
create policy "listing media public read"
on storage.objects for select
using (bucket_id = 'listing-media');

drop policy if exists "listing media authenticated upload" on storage.objects;
create policy "listing media authenticated upload"
on storage.objects for insert
with check (bucket_id = 'listing-media' and auth.role() = 'authenticated');

drop policy if exists "listing media owner update" on storage.objects;
create policy "listing media owner update"
on storage.objects for update
using (bucket_id = 'listing-media' and owner = auth.uid())
with check (bucket_id = 'listing-media' and owner = auth.uid());

drop policy if exists "listing media owner delete" on storage.objects;
create policy "listing media owner delete"
on storage.objects for delete
using (bucket_id = 'listing-media' and owner = auth.uid());

drop policy if exists "profile photos public read" on storage.objects;
create policy "profile photos public read"
on storage.objects for select
using (bucket_id = 'profile-photos');

drop policy if exists "profile photos authenticated upload" on storage.objects;
create policy "profile photos authenticated upload"
on storage.objects for insert
with check (bucket_id = 'profile-photos' and auth.role() = 'authenticated');

drop policy if exists "profile photos owner update" on storage.objects;
create policy "profile photos owner update"
on storage.objects for update
using (bucket_id = 'profile-photos' and owner = auth.uid())
with check (bucket_id = 'profile-photos' and owner = auth.uid());

drop policy if exists "profile photos owner delete" on storage.objects;
create policy "profile photos owner delete"
on storage.objects for delete
using (bucket_id = 'profile-photos' and owner = auth.uid());

-- Location filtering support
alter table public.listings add column if not exists county text;
create index if not exists idx_listings_country on public.listings(country);
create index if not exists idx_listings_state on public.listings(state);
create index if not exists idx_listings_county on public.listings(county);
create index if not exists idx_listings_city on public.listings(city);

create extension if not exists cube;
create extension if not exists earthdistance;

create or replace function public.search_listings_by_radius(
  origin_lat double precision,
  origin_lng double precision,
  radius_miles double precision
)
returns setof public.listings
language sql
stable
as $$
  select l.*
  from public.listings l
  where l.is_active = true
    and l.is_sold = false
    and l.lat is not null
    and l.lng is not null
    and earth_distance(
      ll_to_earth(origin_lat, origin_lng),
      ll_to_earth(l.lat, l.lng)
    ) <= (radius_miles * 1609.34)
  order by earth_distance(
    ll_to_earth(origin_lat, origin_lng),
    ll_to_earth(l.lat, l.lng)
  ) asc;
$$;

-- Optional lookup tables for full dropdown coverage
create table if not exists public.us_counties (
  id bigserial primary key,
  state_name text not null,
  county_name text not null,
  unique (state_name, county_name)
);

create table if not exists public.us_cities (
  id bigserial primary key,
  state_name text not null,
  city_name text not null,
  county_name text
);

create unique index if not exists idx_us_cities_unique
  on public.us_cities(state_name, city_name, coalesce(county_name, ''));
create index if not exists idx_us_counties_state on public.us_counties(state_name);
create index if not exists idx_us_cities_state on public.us_cities(state_name);
create index if not exists idx_us_cities_state_county on public.us_cities(state_name, county_name);

alter table public.us_counties enable row level security;
alter table public.us_cities enable row level security;

drop policy if exists "us_counties read" on public.us_counties;
create policy "us_counties read" on public.us_counties for select using (true);

drop policy if exists "us_cities read" on public.us_cities;
create policy "us_cities read" on public.us_cities for select using (true);
