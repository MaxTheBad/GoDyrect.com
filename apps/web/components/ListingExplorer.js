'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { US_STATES } from '../lib/us-states';

const sortOptions = ['Newest', 'Oldest', 'Price: Low to High', 'Price: High to Low'];
const businessTypes = ['established', 'asset_sale', 'real_estate', 'startup'];
const ageOptions = ['0-1 years', '2-5 years', '6-10 years', '10+ years'];
const milesOptions = ['5', '10', '25', '50', '100', '250'];

export default function ListingExplorer() {
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
  const [mediaModal, setMediaModal] = useState({ open: false, listingId: '', index: 0 });
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [businessNames, setBusinessNames] = useState({});
  const [sellerFollowIds, setSellerFollowIds] = useState([]);
  const [businessFollowIds, setBusinessFollowIds] = useState([]);

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
          const { data: sellerFollowers } = await supabase
            .from('user_follows')
            .select('followed_user_id')
            .in('followed_user_id', sellerIds);
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
          const { data: businessFollowers } = await supabase
            .from('business_follows')
            .select('business_id')
            .in('business_id', businessIds);
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
      if (error) return;
      setSellerFollowIds((prev) => prev.filter((id) => id !== sellerId));
      return;
    }

    const { error } = await supabase.from('user_follows').insert({ follower_user_id: viewerId, followed_user_id: sellerId });
    if (error) return;
    setSellerFollowIds((prev) => [...prev, sellerId]);
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
      const { error } = await supabase.from('business_follows').delete().eq('follower_user_id', viewerId).eq('business_id', businessId);
      if (error) return;
      setBusinessFollowIds((prev) => prev.filter((id) => id !== businessId));
      return;
    }

    const { error } = await supabase.from('business_follows').insert({ follower_user_id: viewerId, business_id: businessId });
    if (error) return;
    setBusinessFollowIds((prev) => [...prev, businessId]);
  }

  function toggleInArray(value, arr, setArr) {
    setArr(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);
  }


  function openMediaModal(listingId, index = 0) {
    setMediaModal({ open: true, listingId, index });
  }

  function closeMediaModal() {
    setMediaModal({ open: false, listingId: '', index: 0 });
  }

  function stepMedia(direction) {
    const items = mediaPreview[mediaModal.listingId] || [];
    if (!items.length) return;
    const next = (mediaModal.index + direction + items.length) % items.length;
    setMediaModal((prev) => ({ ...prev, index: next }));
  }


  return (
    <>
      <section style={heroSection}>
        <h1 style={{ margin: '0 0 8px', fontSize: 30, color: '#111827', letterSpacing: '-0.02em' }}>Buy & sell businesses</h1>
        <p style={{ margin: 0, opacity: 0.75, color: '#374151' }}>Search by business name, category, or keywords.</p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto auto', gap: 8 }}>
          <input
            style={{ ...input, width: '100%' }}
            placeholder='Search business name, categories, keywords'
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySearch();
              }
            }}
          />
          <button style={primaryBtn} onClick={applySearch}>Search</button>
          <button style={ghostBtn} onClick={() => { setToast('Map view is coming soon'); setTimeout(() => setToast(''), 1800); }}>Map View (Coming Soon)</button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label style={sortWrap}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>Sort by</span>
            <select style={input} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {sortOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section style={filterSection}>
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
        <h3 style={{ marginTop: 4, color: '#111827' }}>Business Listings</h3>
        {loadingListings ? <p style={{ opacity: 0.8 }}>Loading listings...</p> : null}
        {!loadingListings && filteredListings.length === 0 ? <p style={{ opacity: 0.8 }}>No active listings found.</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredListings.map((l) => {
            const media = mediaPreview[l.id] || [];
            const isOwner = viewerId && viewerId === l.seller_id;
            const isFavorite = favoriteIds.includes(l.id);
            const followsSeller = sellerFollowIds.includes(l.seller_id);
            const followsBusiness = l.business_id ? businessFollowIds.includes(l.business_id) : false;
            return (
              <div key={l.id} style={listingCard}>
                <div style={{ display: 'grid', gap: 8, flex: 1, minWidth: 0 }}>
                  <strong>{l.title}</strong>
                  <div style={{ opacity: 0.85, color: '#4b5563', fontSize: 13 }}>
                    {(businessNames[l.business_id] || 'Business')} · {prettyCategory(l.category)} · {l.business_age_years ?? 0} years · {[l.city, l.state, l.country].filter(Boolean).join(', ') || 'Location not set'}
                  </div>
                  {media.length ? (
                    <div style={mediaScroller}>
                      {media.slice(0, 10).map((m, i) => (
                        <button key={m.url + i} type='button' onClick={() => openMediaModal(l.id, i)} style={mediaThumbWrap} title='Preview media'>
                          {m.media_type === 'video' ? (
                            <div style={{ ...mediaThumb, ...videoThumb }}>▶</div>
                          ) : (
                            <img src={m.thumbnail_url || m.url} alt='preview' style={mediaThumb} />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <strong>${Number(l.asking_price || 0).toLocaleString()}</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type='button' onClick={() => toggleFavorite(l.id)} style={miniBtn}>{isFavorite ? '★ Saved' : '☆ Favorite'}</button>
                    {!isOwner ? <button type='button' onClick={() => toggleFollowSeller(l.seller_id)} style={miniBtn}>{followsSeller ? 'Unfollow Seller' : 'Follow Seller'}</button> : null}
                    {l.business_id ? <button type='button' onClick={() => toggleFollowBusiness(l.business_id)} style={miniBtn}>{followsBusiness ? 'Unfollow Biz' : 'Follow Biz'}</button> : null}
                    <a href={`/listing?id=${l.id}`} style={miniBtn}>View</a>
                    {isOwner ? <a href={`/listings/edit?id=${l.id}`} style={miniBtn}>Edit</a> : <a href={`/messages?seller=${l.seller_id}&listing=${l.id}`} style={miniBtn}>Message</a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>


      {mediaModal.open ? (
        <div style={modalBackdrop} onClick={closeMediaModal}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const items = mediaPreview[mediaModal.listingId] || [];
              const current = items[mediaModal.index];
              if (!current) return <p style={{ color: '#fff' }}>No media.</p>;
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ color: '#fff' }}>Media preview</strong>
                    <button style={closeBtn} onClick={closeMediaModal}>✕</button>
                  </div>

                  <div style={modalMediaWrap}>
                    {current.media_type === 'video' ? (
                      <video src={current.url} controls autoPlay style={modalMedia} />
                    ) : (
                      <img src={current.url} alt='media' style={modalMedia} />
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <button style={navBtn} onClick={() => stepMedia(-1)}>Prev</button>
                    <span style={{ color: '#d1d5db', fontSize: 12 }}>{mediaModal.index + 1} / {items.length}</span>
                    <button style={navBtn} onClick={() => stepMedia(1)}>Next</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

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

const heroSection = { marginTop: 24, background: '#fff', border: '1px solid #eceff5', borderRadius: 20, padding: 18, boxShadow: '0 8px 24px rgba(17,24,39,0.06)' };
const filterSection = { marginTop: 16, background: '#fff', border: '1px solid #eceff5', borderRadius: 20, padding: 12, boxShadow: '0 8px 24px rgba(17,24,39,0.06)' };
const mobileFilterToggle = { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', color: '#111827', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const listingSection = { marginTop: 16, background: '#fff', border: '1px solid #eceff5', borderRadius: 20, padding: 12, boxShadow: '0 8px 24px rgba(17,24,39,0.06)' };
const primaryBtn = { border: 0, borderRadius: 999, background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 45%, #8134af 75%, #515bd4 100%)', color: '#fff', padding: '10px 14px', cursor: 'pointer', fontWeight: 600 };
const ghostBtn = { border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', color: '#111827', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const input = { borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', color: '#111827', padding: '10px 12px', width: '100%' };
const sortWrap = { display: 'grid', gap: 4 };
const dropWrap = { background: '#f9fafb', border: '1px solid #eceff5', borderRadius: 14, padding: 10 };
const dropBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', color: '#111827', padding: '10px 12px', cursor: 'pointer', fontWeight: 600 };
const rowLabel = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#374151' };
const toastStyle = { position: 'fixed', bottom: 92, right: 20, background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 12, boxShadow: '0 10px 24px rgba(17,24,39,0.25)' };
const listingCard = { border: '1px solid #eceff5', borderRadius: 16, background: '#fff', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'nowrap' };
const mediaScroller = { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 };
const mediaThumbWrap = { border: 0, background: 'transparent', padding: 0, cursor: 'pointer' };
const mediaThumb = { width: 108, height: 108, borderRadius: 14, objectFit: 'cover', border: '1px solid #eceff5', display: 'block' };
const videoThumb = { display: 'grid', placeItems: 'center', background: '#f3f4f6', color: '#374151', fontSize: 14 };
const miniBtn = { border: '1px solid #eceff5', borderRadius: 999, background: '#fff', color: '#111827', padding: '6px 10px', textDecoration: 'none', fontSize: 12, fontWeight: 600 };

const modalBackdrop = { position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.72)', display: 'grid', placeItems: 'center', zIndex: 1200, padding: 16 };
const modalCard = { width: 'min(780px, 96vw)', background: '#0b1228', border: '1px solid #2e3f73', borderRadius: 14, padding: 10 };
const modalMediaWrap = { borderRadius: 10, overflow: 'hidden', border: '1px solid #2e3f73', background: '#050a1a' };
const modalMedia = { width: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' };
const closeBtn = { border: '1px solid #34467f', borderRadius: 8, background: '#0f1738', color: '#fff', padding: '6px 10px', cursor: 'pointer' };
const navBtn = { border: '1px solid #34467f', borderRadius: 8, background: '#0f1738', color: '#fff', padding: '6px 12px', cursor: 'pointer' };
