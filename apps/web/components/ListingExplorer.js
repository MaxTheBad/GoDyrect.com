'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { US_STATES } from '../lib/us-states';
import { FeedPost } from '../app/feed/feed-components';

const sortOptions = ['Newest', 'Oldest', 'Price: Low to High', 'Price: High to Low'];
const businessTypes = ['established', 'asset_sale', 'real_estate', 'startup'];
const ageOptions = ['0-1 years', '2-5 years', '6-10 years', '10+ years'];
const milesOptions = ['5', '10', '25', '50', '100', '250'];

export default function ListingExplorer({ initialSearch = '', initialIndustry = 'all' }) {
  const [toast, setToast] = useState('');
  const [openFilter, setOpenFilter] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [listings, setListings] = useState([]);
  const [mediaPreview, setMediaPreview] = useState({});
  const [loadingListings, setLoadingListings] = useState(true);
  const [viewerId, setViewerId] = useState('');

  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedAges, setSelectedAges] = useState([]);
  const [country, setCountry] = useState('United States');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [county, setCounty] = useState('');
  const [countyOptions, setCountyOptions] = useState([]);
  const [cityOptions, setCityOptions] = useState([]);
  const [miles, setMiles] = useState('');
  const [originLatLng, setOriginLatLng] = useState(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('Newest');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(initialSearch);
  const [searchQuery, setSearchQuery] = useState(initialSearch.trim().toLowerCase());
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [businessNames, setBusinessNames] = useState({});
  const [sellerFollowIds, setSellerFollowIds] = useState([]);
  const [businessFollowIds, setBusinessFollowIds] = useState([]);
  const [sellerProfiles, setSellerProfiles] = useState({});
  const [cardMediaIndex, setCardMediaIndex] = useState({});

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    async function loadListings() {
      if (!supabase) return setLoadingListings(false);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || '';
      setViewerId(uid);

      if (uid) {
        const { data: favoriteRows } = await supabase
          .from('favorites')
          .select('listing_id')
          .eq('user_id', uid);
        setFavoriteIds((favoriteRows || []).map((r) => r.listing_id));
      }

      const { data } = await supabase
        .from('listings')
        .select('id,seller_id,business_id,title,description,category,lister_role,business_age_years,asking_price,city,state,country,county,lat,lng,created_at')
        .eq('is_active', true)
        .eq('is_sold', false)
        .order('created_at', { ascending: false })
        .limit(100);

      const rows = data || [];
      setListings(rows);

      if (rows.length) {
        const sellerIds = [...new Set(rows.map((r) => r.seller_id).filter(Boolean))];
        const businessIds = [...new Set(rows.map((r) => r.business_id).filter(Boolean))];
        if (businessIds.length) {
          const { data: businesses } = await supabase
            .from('businesses')
            .select('id,name')
            .in('id', businessIds);
          const map = {};
          (businesses || []).forEach((b) => {
            map[b.id] = b.name;
          });
          setBusinessNames(map);
        }

        if (sellerIds.length) {
          const { data: sellers } = await supabase
            .from('profiles')
            .select('id,full_name,handle,avatar_url')
            .in('id', sellerIds);
          const profileMap = {};
          (sellers || []).forEach((u) => {
            profileMap[u.id] = u;
          });
          setSellerProfiles(profileMap);

          if (uid) {
            const { data: mySellerFollows } = await supabase
              .from('user_follows')
              .select('followed_user_id')
              .eq('follower_user_id', uid)
              .in('followed_user_id', sellerIds);
            setSellerFollowIds((mySellerFollows || []).map((f) => f.followed_user_id));
          }
        }

        if (businessIds.length) {
          if (uid) {
            const { data: myBusinessFollows } = await supabase
              .from('business_follows')
              .select('business_id')
              .eq('follower_user_id', uid)
              .in('business_id', businessIds);
            setBusinessFollowIds((myBusinessFollows || []).map((f) => f.business_id));
          }
        }

        const ids = rows.map((r) => r.id);
        const { data: media } = await supabase
          .from('listing_media')
          .select('listing_id,media_type,url,thumbnail_url,sort_order')
          .in('listing_id', ids);

        const preview = {};
        (media || []).forEach((m) => {
          if (!preview[m.listing_id]) preview[m.listing_id] = [];
          preview[m.listing_id].push(m);
        });
        Object.keys(preview).forEach((id) => {
          preview[id].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        });
        setMediaPreview(preview);
      }

      setLoadingListings(false);
    }
    loadListings();
  }, []);

  useEffect(() => {
    setSearchDraft(initialSearch);
    setSearchQuery(initialSearch.trim().toLowerCase());
  }, [initialSearch]);

  useEffect(() => {
    if (initialIndustry && initialIndustry !== 'all') {
      setSelectedTypes([initialIndustry].filter(Boolean));
    }
  }, [initialIndustry]);

  useEffect(() => {
    async function loadCountyCityOptions() {
      if (!supabase || !state) {
        setCountyOptions([]);
        setCityOptions([]);
        return;
      }

      const [{ data: counties }, { data: cities }] = await Promise.all([
        supabase.from('us_counties').select('county_name').eq('state_name', state).order('county_name'),
        supabase.from('us_cities').select('city_name').eq('state_name', state).order('city_name'),
      ]);

      setCountyOptions((counties || []).map((r) => r.county_name));
      setCityOptions((cities || []).map((r) => r.city_name));
    }

    loadCountyCityOptions();
  }, [state]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setToast('Geolocation not available on this device');
      setTimeout(() => setToast(''), 1600);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOriginLatLng({ lat: position.coords.latitude, lng: position.coords.longitude });
        setToast('Location captured for miles filter');
        setTimeout(() => setToast(''), 1600);
      },
      () => {
        setToast('Could not access location');
        setTimeout(() => setToast(''), 1600);
      }
    );
  }

  const countries = useMemo(() => [...new Set(['United States', ...listings.map((l) => l.country).filter(Boolean)])], [listings]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchDraft.trim().toLowerCase());
    }, 120);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedTypes.length) count += 1;
    if (selectedAges.length) count += 1;
    if (minPrice || maxPrice) count += 1;
    if (country || state || county || city) count += 1;
    if (miles) count += 1;
    return count;
  }, [selectedTypes, selectedAges, minPrice, maxPrice, country, state, county, city, miles]);

  const filteredListings = useMemo(() => {
    let rows = [...listings];

    if (searchQuery) {
      rows = rows.filter((l) => {
        const haystack = [l.title, l.description, l.category, l.city, l.state, l.country, l.county]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchQuery);
      });
    }

    if (selectedTypes.length) rows = rows.filter((l) => selectedTypes.includes(l.category));
    if (selectedAges.length) {
      rows = rows.filter((l) => {
        const age = Number(l.business_age_years || 0);
        return selectedAges.some((bucket) => {
          if (bucket === '0-1 years') return age <= 1;
          if (bucket === '2-5 years') return age >= 2 && age <= 5;
          if (bucket === '6-10 years') return age >= 6 && age <= 10;
          if (bucket === '10+ years') return age >= 10;
          return true;
        });
      });
    }

    if (country) rows = rows.filter((l) => l.country === country);
    if (state) rows = rows.filter((l) => l.state === state);
    if (county) rows = rows.filter((l) => l.county === county);
    if (city) rows = rows.filter((l) => l.city === city);

    if (minPrice) rows = rows.filter((l) => Number(l.asking_price || 0) >= Number(minPrice));
    if (maxPrice) rows = rows.filter((l) => Number(l.asking_price || 0) <= Number(maxPrice));

    if (miles && originLatLng) {
      rows = rows.filter((l) => l.lat && l.lng && milesBetween(originLatLng.lat, originLatLng.lng, l.lat, l.lng) <= Number(miles));
    }

    if (sortBy === 'Newest') rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sortBy === 'Oldest') rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (sortBy === 'Price: Low to High') rows.sort((a, b) => Number(a.asking_price || 0) - Number(b.asking_price || 0));
    if (sortBy === 'Price: High to Low') rows.sort((a, b) => Number(b.asking_price || 0) - Number(a.asking_price || 0));

    return rows;
  }, [listings, searchQuery, selectedTypes, selectedAges, country, state, city, county, minPrice, maxPrice, sortBy, miles, originLatLng]);

  function toggleFilter(key) {
    setOpenFilter((curr) => (curr === key ? null : key));
  }

  function applySearch() {
    setSearchQuery(searchDraft.trim().toLowerCase());
  }

  async function toggleFavorite(listingId) {
    if (!supabase) return;
    if (!viewerId) {
      setToast('Please sign in to save favorites');
      setTimeout(() => setToast(''), 1800);
      return;
    }

    const isFavorite = favoriteIds.includes(listingId);
    if (isFavorite) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', viewerId).eq('listing_id', listingId);
      if (error) {
        setToast(error.message);
        setTimeout(() => setToast(''), 1800);
        return;
      }
      setFavoriteIds((prev) => prev.filter((id) => id !== listingId));
      return;
    }

    const { error } = await supabase.from('favorites').insert({ user_id: viewerId, listing_id: listingId });
    if (error) {
      setToast(error.message);
      setTimeout(() => setToast(''), 1800);
      return;
    }
    setFavoriteIds((prev) => [...prev, listingId]);
  }

  async function toggleFollowSeller(sellerId) {
    if (!supabase) return;
    if (!viewerId) {
      setToast('Please sign in to follow sellers');
      setTimeout(() => setToast(''), 1800);
      return;
    }
    if (viewerId === sellerId) return;

    const isFollowing = sellerFollowIds.includes(sellerId);
    if (isFollowing) {
      const { error } = await supabase.from('user_follows').delete().eq('follower_user_id', viewerId).eq('followed_user_id', sellerId);
      if (error) {
        setToast(error.message || 'Could not unfollow seller');
        setTimeout(() => setToast(''), 2200);
        return;
      }
      setSellerFollowIds((prev) => prev.filter((id) => id !== sellerId));
      setToast('Unfollowed seller');
      setTimeout(() => setToast(''), 1200);
      return;
    }

    const { error } = await supabase.from('user_follows').insert({ follower_user_id: viewerId, followed_user_id: sellerId });
    if (error) {
      if (error.message?.includes('duplicate key')) {
        setSellerFollowIds((prev) => (prev.includes(sellerId) ? prev : [...prev, sellerId]));
        setToast('Already following this seller');
        setTimeout(() => setToast(''), 1200);
        return;
      }
      setToast(error.message || 'Could not follow seller');
      setTimeout(() => setToast(''), 2200);
      return;
    }
    setSellerFollowIds((prev) => [...prev, sellerId]);
    setToast('Following seller');
    setTimeout(() => setToast(''), 1200);
  }

  async function toggleFollowBusiness(businessId) {
    if (!supabase || !businessId) return;
    if (!viewerId) {
      setToast('Please sign in to follow businesses');
      setTimeout(() => setToast(''), 1800);
      return;
    }

    const isFollowing = businessFollowIds.includes(businessId);
    if (isFollowing) {
      const { error } = await supabase
        .from('business_follows')
        .delete()
        .eq('follower_user_id', viewerId)
        .eq('business_id', businessId);
      if (error) {
        setToast(error.message || 'Could not unfollow business');
        setTimeout(() => setToast(''), 2200);
        return;
      }
      setBusinessFollowIds((prev) => prev.filter((id) => id !== businessId));
      setToast('Unfollowed business');
      setTimeout(() => setToast(''), 1200);
      return;
    }

    const { error } = await supabase
      .from('business_follows')
      .insert({ follower_user_id: viewerId, business_id: businessId });

    if (error) {
      if (error.message?.includes('schema cache') || error.message?.includes("public.business_follows")) {
        setToast('Business follows DB table is missing. Run latest Supabase SQL migration.');
        setTimeout(() => setToast(''), 3200);
        return;
      }
      if (error.message?.includes('duplicate key')) {
        setBusinessFollowIds((prev) => (prev.includes(businessId) ? prev : [...prev, businessId]));
        setToast('Already following this business');
        setTimeout(() => setToast(''), 1200);
        return;
      }
      setToast(error.message || 'Could not follow business');
      setTimeout(() => setToast(''), 2400);
      return;
    }

    setBusinessFollowIds((prev) => [...prev, businessId]);
    setToast('Following business');
    setTimeout(() => setToast(''), 1200);
  }

  function toggleInArray(value, arr, setArr) {
    setArr(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);
  }

  function stepCardMedia(listingId, direction) {
    const items = mediaPreview[listingId] || [];
    if (!items.length) return;
    const curr = cardMediaIndex[listingId] || 0;
    const next = (curr + direction + items.length) % items.length;
    setCardMediaIndex((prev) => ({ ...prev, [listingId]: next }));
  }


  return (
    <>
      <section style={filterSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={sortWrap}>
            <span style={{ fontSize: 13, opacity: 0.8, color: 'rgba(235,241,255,0.78)' }}>Sort by</span>
            <select style={input} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {sortOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <button style={ghostBtn} onClick={() => { setToast('Map view is coming soon'); setTimeout(() => setToast(''), 1800); }}>Map View (Coming Soon)</button>
        </div>

        {isMobile ? (
          <button style={mobileFilterToggle} onClick={() => setMobileFiltersOpen((v) => !v)}>
            <span>{mobileFiltersOpen ? 'Hide filters' : 'Show filters'}</span>
            <span style={{ opacity: 0.8 }}>{activeFilterCount ? `${activeFilterCount} active` : 'No filters'}</span>
          </button>
        ) : null}

        {!isMobile || mobileFiltersOpen ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0, 1fr))', gap: 10, marginTop: isMobile ? 10 : 0 }}>
            <DropdownFilter title='Business type' isOpen={openFilter === 'type'} onToggle={() => toggleFilter('type')}>
              {businessTypes.map((option) => (
                <label key={option} style={rowLabel}>
                  <input type='checkbox' checked={selectedTypes.includes(option)} onChange={() => toggleInArray(option, selectedTypes, setSelectedTypes)} /> {prettyCategory(option)}
                </label>
              ))}
            </DropdownFilter>

            <DropdownFilter title='Business age' isOpen={openFilter === 'age'} onToggle={() => toggleFilter('age')}>
              {ageOptions.map((option) => (
                <label key={option} style={rowLabel}>
                  <input type='checkbox' checked={selectedAges.includes(option)} onChange={() => toggleInArray(option, selectedAges, setSelectedAges)} /> {option}
                </label>
              ))}
            </DropdownFilter>

            <DropdownFilter title='Price range' isOpen={openFilter === 'price'} onToggle={() => toggleFilter('price')}>
              <input style={input} placeholder='Min price' value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
              <input style={{ ...input, marginTop: 8 }} placeholder='Max price' value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </DropdownFilter>

            <DropdownFilter title='Location' isOpen={openFilter === 'location'} onToggle={() => toggleFilter('location')}>
              <select style={input} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value=''>Country</option>{countries.map((v) => <option key={v}>{v}</option>)}
              </select>
              <select style={{ ...input, marginTop: 8 }} value={state} onChange={(e) => { setState(e.target.value); setCounty(''); setCity(''); }}>
                <option value=''>State</option>{US_STATES.map((v) => <option key={v}>{v}</option>)}
              </select>
              <input
                list='county-options'
                style={{ ...input, marginTop: 8 }}
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                placeholder='County'
              />
              <datalist id='county-options'>
                {countyOptions.map((v) => <option key={v} value={v} />)}
              </datalist>
              <input
                list='city-options'
                style={{ ...input, marginTop: 8 }}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder='City'
              />
              <datalist id='city-options'>
                {cityOptions.map((v) => <option key={v} value={v} />)}
              </datalist>
            </DropdownFilter>

            <DropdownFilter title='Miles from' isOpen={openFilter === 'miles'} onToggle={() => toggleFilter('miles')}>
              <button style={ghostBtn} onClick={requestLocation}>Use my location</button>
              <select style={{ ...input, marginTop: 8 }} value={miles} onChange={(e) => setMiles(e.target.value)}>
                <option value=''>Miles</option>{milesOptions.map((v) => <option key={v} value={v}>{v} miles</option>)}
              </select>
            </DropdownFilter>
          </div>
        ) : null}
      </section>

      <section style={listingSection}>
        <h3 style={{ marginTop: 4, color: '#fff' }}>Business Listings</h3>
        {loadingListings ? <p style={{ opacity: 0.8, color: 'rgba(235,241,255,0.78)' }}>Loading listings...</p> : null}
        {!loadingListings && filteredListings.length === 0 ? <p style={{ opacity: 0.8, color: 'rgba(235,241,255,0.78)' }}>No active listings found.</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredListings.map((l) => {
            const media = mediaPreview[l.id] || [];
            const currentIndex = cardMediaIndex[l.id] || 0;
            const isOwner = viewerId && viewerId === l.seller_id;
            const isFavorite = favoriteIds.includes(l.id);
            const followsSeller = sellerFollowIds.includes(l.seller_id);
            const followsBusiness = l.business_id ? businessFollowIds.includes(l.business_id) : false;
            const seller = sellerProfiles[l.seller_id];
            return (
              <div key={l.id} style={{ display: 'grid', gap: 10 }}>
                <FeedPost
                  listing={l}
                  businessName={businessNames[l.business_id] || prettyCategory(l.category)}
                  businessLocation={[l.city, l.state, l.country].filter(Boolean).join(', ') || 'Location not set'}
                  sellerName={seller?.full_name || seller?.handle || 'Seller'}
                  media={media}
                  activeIndex={currentIndex}
                  onPrev={() => stepCardMedia(l.id, -1)}
                  onNext={() => stepCardMedia(l.id, 1)}
                  onPick={(index) => setCardMediaIndex((prev) => ({ ...prev, [l.id]: index }))}
                  onOpen={`/listing?id=${l.id}`}
                  isFavorite={isFavorite}
                  onToggleFavorite={() => toggleFavorite(l.id)}
                  onToggleSellerFollow={!isOwner ? () => toggleFollowSeller(l.seller_id) : null}
                  onToggleBusinessFollow={l.business_id ? () => toggleFollowBusiness(l.business_id) : null}
                  onEdit={isOwner ? () => window.location.assign(`/listings/edit?id=${l.id}`) : null}
                />
                <div style={cardBottom}>
                  <strong style={{ color: '#fff' }}>${Number(l.asking_price || 0).toLocaleString()}</strong>
                  <span style={listingFooterNote}>{prettyCategory(l.category)} · {l.business_age_years ?? 0} years</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>


      {toast ? <div style={toastStyle}>{toast}</div> : null}
    </>
  );
}

function DropdownFilter({ title, isOpen, onToggle, children }) {
  return (
    <div style={dropWrap}>
      <button onClick={onToggle} style={dropBtn}>
        <span>{title}</span>
        <span style={{ opacity: 0.8 }}>{isOpen ? '▴' : '▾'}</span>
      </button>
      {isOpen ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </div>
  );
}

function prettyCategory(value) {
  if (value === 'asset_sale') return 'Asset Sales';
  if (value === 'real_estate') return 'Real Estate';
  if (value === 'startup') return 'Start-up Businesses';
  return 'Established Businesses';
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const toRad = (n) => (n * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const filterSection = { marginTop: 16, background: '#0f1732', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 20, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' };
const mobileFilterToggle = { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 12, background: '#121b3f', color: '#fff', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const listingSection = { marginTop: 16, background: '#0f1732', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 20, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' };
const primaryBtn = { border: 0, borderRadius: 999, background: '#2e7dff', color: '#fff', padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };
const ghostBtn = { border: '1px solid rgba(94,128,202,0.28)', borderRadius: 999, background: '#121b3f', color: '#fff', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const input = { borderRadius: 12, border: '1px solid rgba(94,128,202,0.28)', background: '#0b1431', color: '#fff', padding: '10px 12px', width: '100%' };
const sortWrap = { display: 'grid', gap: 4 };
const dropWrap = { background: '#0b1431', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 14, padding: 10 };
const dropBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 12, background: '#121b3f', color: '#fff', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const rowLabel = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'rgba(235,241,255,0.78)' };
const toastStyle = { position: 'fixed', bottom: 92, right: 20, background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 12, boxShadow: '0 10px 24px rgba(17,24,39,0.25)' };
const listingCard = { border: '1px solid rgba(94,128,202,0.28)', borderRadius: 18, background: '#121b3f', padding: 14, display: 'grid', gap: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' };
const listingTopRow = { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) auto', gap: 12, alignItems: 'start' };
const listingAvatar = { width: 42, height: 42, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)', color: '#0f172a', fontSize: 18, fontWeight: 800, border: '1px solid rgba(94,128,202,0.28)' };
const listingTitle = { color: '#fff', textDecoration: 'none', fontWeight: 800, fontSize: 18, lineHeight: 1.1 };
const listingMeta = { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.82)', alignItems: 'center', marginTop: 2 };
const listingBusiness = { fontWeight: 700, color: '#fff' };
const listingLocation = { marginTop: 2, fontSize: 13, color: 'rgba(255,255,255,0.72)' };
const listingActions = { display: 'flex', alignItems: 'center', gap: 10, justifySelf: 'end', position: 'relative' };
const listingOpenPill = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 88, height: 48, padding: '0 18px', borderRadius: 999, border: '1px solid #d7dbe5', background: '#fff', color: '#111827', textDecoration: 'none', fontWeight: 800, fontSize: 18 };
const listingFooterNote = { color: 'rgba(235,241,255,0.72)', fontSize: 13 };
const mediaStageWrap = { position: 'relative', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(94,128,202,0.28)', background: '#050a1a' };
const mediaMainBtn = { border: 0, padding: 0, background: 'transparent', width: '100%', cursor: 'pointer' };
const mediaMain = { width: '100%', height: 420, objectFit: 'cover', display: 'block' };
const mediaNavLeft = { position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', border: 0, borderRadius: 999, width: 30, height: 30, background: 'rgba(255,255,255,0.9)', color: '#111827', cursor: 'pointer' };
const mediaNavRight = { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 0, borderRadius: 999, width: 30, height: 30, background: 'rgba(255,255,255,0.9)', color: '#111827', cursor: 'pointer' };
const dotWrap = { position: 'absolute', left: 0, right: 0, bottom: 10, display: 'flex', justifyContent: 'center', gap: 6 };
const dot = { width: 6, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.55)' };
const dotActive = { width: 8, height: 8, borderRadius: 999, background: '#fff' };
const cardBottom = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const menuBtn = { border: '1px solid rgba(94,128,202,0.28)', borderRadius: 999, background: '#0b1431', color: '#fff', width: 34, height: 34, fontSize: 18, lineHeight: 1, cursor: 'pointer' };
const menuPanel = { position: 'absolute', right: 0, top: 40, background: '#0f1732', border: '1px solid rgba(94,128,202,0.28)', borderRadius: 10, minWidth: 180, display: 'grid', zIndex: 5, boxShadow: '0 10px 24px rgba(0,0,0,0.2)' };
const menuItem = { border: 0, borderBottom: '1px solid rgba(94,128,202,0.18)', background: '#0f1732', textAlign: 'left', padding: '10px 12px', cursor: 'pointer', color: '#fff' };
const menuLink = { padding: '10px 12px', textDecoration: 'none', color: '#fff', borderBottom: '1px solid rgba(94,128,202,0.18)' };

const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.72)', display: 'grid', placeItems: 'center', zIndex: 1200, padding: 16 };
const modalCard = { width: 'min(780px, 96vw)', background: '#0b1228', border: '1px solid #2e3f73', borderRadius: 14, padding: 10 };
const modalMediaWrap = { borderRadius: 10, overflow: 'hidden', border: '1px solid #2e3f73', background: '#050a1a' };
const modalMedia = { width: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' };
const closeBtn = { border: '1px solid #34467f', borderRadius: 8, background: '#0f1738', color: '#fff', padding: '6px 10px', cursor: 'pointer' };
const navBtn = { border: '1px solid #34467f', borderRadius: 8, background: '#0f1738', color: '#fff', padding: '6px 12px', cursor: 'pointer' };
