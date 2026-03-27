-- BizMarket initial schema
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  full_name text,
  avatar_url text,
  bio text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create type public.listing_category as enum (
  'established',
  'asset_sale',
  'real_estate',
  'startup'
);

create table if not exists public.listings (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category public.listing_category not null,
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

-- RLS
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_media enable row level security;
alter table public.favorites enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Policies: profiles
create policy "profiles are public readable" on public.profiles
for select using (true);
create policy "users can upsert own profile" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

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

-- Search support (name/category/keywords only, not description)
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
