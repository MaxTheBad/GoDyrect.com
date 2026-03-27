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
  const [mediaCounts, setMediaCounts] = useState({});
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
      setViewerId(auth?.user?.id || '');

      const { data } = await supabase
        .from('listings')
        .select('id,seller_id,title,description,category,business_age_years,asking_price,city,state,country,county,lat,lng,created_at')
        .eq('is_active', true)
        .eq('is_sold', false)
        .order('created_at', { ascending: false })
        .limit(100);

      const rows = data || [];
      setListings(rows);

      if (rows.length) {
        const ids = rows.map((r) => r.id);
        const { data: media } = await supabase
          .from('listing_media')
          .select('listing_id,media_type')
          .in('listing_id', ids);

        const counts = {};
        (media || []).forEach((m) => {
          if (!counts[m.listing_id]) counts[m.listing_id] = { photos: 0, videos: 0 };
          if (m.media_type === 'video') counts[m.listing_id].videos += 1;
          else counts[m.listing_id].photos += 1;
        });
        setMediaCounts(counts);
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

  const filteredListings = useMemo(() => {
    let rows = [...listings];

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
  }, [listings, selectedTypes, selectedAges, country, state, city, county, minPrice, maxPrice, sortBy, miles, originLatLng]);

  function toggleFilter(key) {
    setOpenFilter((curr) => (curr === key ? null : key));
  }

  function toggleInArray(value, arr, setArr) {
    setArr(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);
  }

  return (
    <>
      <section style={heroSection}>
        <h1 style={{ margin: '0 0 8px', fontSize: 30 }}>Buy & sell businesses</h1>
        <p style={{ margin: 0, opacity: 0.86 }}>Search by business name, category, or keywords.</p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto auto', gap: 8 }}>
          <input style={{ ...input, width: '100%' }} placeholder='Search business name, categories, keywords' />
          <button style={primaryBtn}>Search</button>
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
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
            <select style={{ ...input, marginTop: 8 }} value={county} onChange={(e) => setCounty(e.target.value)}>
              <option value=''>County</option>{countyOptions.map((v) => <option key={v}>{v}</option>)}
            </select>
            <select style={{ ...input, marginTop: 8 }} value={city} onChange={(e) => setCity(e.target.value)}>
              <option value=''>City</option>{cityOptions.map((v) => <option key={v}>{v}</option>)}
            </select>
          </DropdownFilter>

          <DropdownFilter title='Miles from' isOpen={openFilter === 'miles'} onToggle={() => toggleFilter('miles')}>
            <button style={ghostBtn} onClick={requestLocation}>Use my location</button>
            <select style={{ ...input, marginTop: 8 }} value={miles} onChange={(e) => setMiles(e.target.value)}>
              <option value=''>Miles</option>{milesOptions.map((v) => <option key={v} value={v}>{v} miles</option>)}
            </select>
          </DropdownFilter>
        </div>
      </section>

      <section style={listingSection}>
        <h3 style={{ marginTop: 4 }}>Business Listings</h3>
        {loadingListings ? <p style={{ opacity: 0.8 }}>Loading listings...</p> : null}
        {!loadingListings && filteredListings.length === 0 ? <p style={{ opacity: 0.8 }}>No active listings found.</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {filteredListings.map((l) => {
            const counts = mediaCounts[l.id] || { photos: 0, videos: 0 };
            const isOwner = viewerId && viewerId === l.seller_id;
            return (
              <div key={l.id} style={listingCard}>
                <div>
                  <strong>{l.title}</strong>
                  <div style={{ opacity: 0.8, fontSize: 13 }}>
                    {prettyCategory(l.category)} · {l.business_age_years ?? 0} years · {[l.city, l.state, l.country].filter(Boolean).join(', ') || 'Location not set'}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>{counts.photos} photos · {counts.videos} videos</div>
                </div>
                <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <strong>${Number(l.asking_price || 0).toLocaleString()}</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <a href={`/listing?id=${l.id}`} style={miniBtn}>View</a>
                    {isOwner ? <a href={`/listings/edit?id=${l.id}`} style={miniBtn}>Edit</a> : <a href={`/messages?seller=${l.seller_id}&listing=${l.id}`} style={miniBtn}>Message</a>}
                  </div>
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

const heroSection = { marginTop: 24, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 18 };
const filterSection = { marginTop: 16, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 12 };
const listingSection = { marginTop: 16, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 12 };
const primaryBtn = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const input = { borderRadius: 10, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px', width: '100%' };
const sortWrap = { display: 'grid', gap: 4 };
const dropWrap = { background: '#0f1738', border: '1px solid #26366d', borderRadius: 12, padding: 10 };
const dropBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const rowLabel = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const toastStyle = { position: 'fixed', bottom: 92, right: 20, background: '#1f2d5c', border: '1px solid #3654a8', padding: '10px 14px', borderRadius: 10 };
const listingCard = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' };
const miniBtn = { border: '1px solid #304178', borderRadius: 8, background: '#13204a', color: '#fff', padding: '6px 10px', textDecoration: 'none', fontSize: 12 };
