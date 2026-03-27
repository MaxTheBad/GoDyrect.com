# BizMarket

Cross-platform business marketplace:
- Web: Next.js
- Mobile: Expo (iOS/Android)
- Backend: Supabase (Auth, Postgres, Storage, Realtime)

## Phase 1 (MVP)
- Auth + profiles
- Listings with image/video uploads
- Favorites
- List + map toggle
- Sorting + filters
- Buyer/seller messaging

## Local setup
1. Copy env files:
   - `cp .env.example .env.local`
   - `cp apps/mobile/.env.example apps/mobile/.env`
2. Fill in API keys.
3. Create Supabase project and run SQL in `supabase/schema.sql`.
4. Build web and mobile apps.

## Stack decisions
- Maps: Mapbox
- Media: Cloudinary (initial)
- Hosting: Cloudflare (web) + Supabase backend


Deployment note: use latest commit on main.
