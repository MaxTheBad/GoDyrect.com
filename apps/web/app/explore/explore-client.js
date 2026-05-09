'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import ListingExplorer from '../../components/ListingExplorer';

export default function ExploreClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '');
  const [industry, setIndustry] = useState(searchParams.get('industry') || 'all');
  const initialSearch = searchParams.get('q') || '';
  const initialIndustry = searchParams.get('industry') || 'all';

  function runSearch() {
    const params = new URLSearchParams();
    if (searchDraft.trim()) params.set('q', searchDraft.trim());
    if (industry !== 'all') params.set('industry', industry);
    router.push(`/explore${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <div style={shell}>
      <section style={heroShell}>
        <div style={heroOverlay} />
        <div style={heroContent}>
          <div style={eyebrow}>Discover deals, businesses, and brokers</div>
          <h1 style={title}>Find a business for sale</h1>
          <p style={subtitle}>Use search and filters here. Your Feed stays focused on people and businesses you already follow.</p>

          <div style={searchBar}>
            <div style={searchFieldWrap}>
              <label style={srOnly} htmlFor='explore-search'>Search</label>
              <input
                id='explore-search'
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder='California, Miami, 33101, coffee shop...'
                style={searchInput}
              />
            </div>
            <div style={divider} />
            <div style={searchFieldWrap}>
              <label style={srOnly} htmlFor='explore-industry'>Industry</label>
              <select id='explore-industry' value={industry} onChange={(e) => setIndustry(e.target.value)} style={searchSelect}>
                <option value='all'>All Industries</option>
                <option value='established'>Established Businesses</option>
                <option value='asset_sale'>Asset Sales</option>
                <option value='real_estate'>Real Estate</option>
                <option value='startup'>Start-Ups</option>
              </select>
            </div>
            <button type='button' style={searchBtn} onClick={runSearch}>Search</button>
          </div>
        </div>
      </section>

      <ListingExplorer
        initialSearch={initialSearch}
        initialIndustry={initialIndustry}
      />
    </div>
  );
}

const shell = { display: 'grid', gap: 18 };
const heroShell = {
  position: 'relative',
  minHeight: '66vh',
  borderRadius: 28,
  overflow: 'hidden',
  backgroundImage: "url('/bg.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  boxShadow: '0 24px 60px rgba(0,0,0,0.26)',
};
const heroOverlay = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(6,10,24,0.42) 0%, rgba(11,16,32,0.76) 58%, rgba(11,16,32,0.96) 100%)',
};
const heroContent = { position: 'relative', zIndex: 1, minHeight: '66vh', display: 'grid', placeItems: 'center', gap: 12, textAlign: 'center', padding: '44px 18px 38px' };
const eyebrow = { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
const title = { margin: 0, color: '#fff', fontSize: 'clamp(30px, 5vw, 56px)', lineHeight: 1.02 };
const subtitle = { margin: 0, maxWidth: 820, color: 'rgba(235,241,255,0.78)', fontSize: 18, lineHeight: 1.5 };
const searchBar = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) 1px minmax(220px, 0.95fr) auto', alignItems: 'stretch', borderRadius: 18, overflow: 'hidden', background: '#fff', boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)' };
const searchFieldWrap = { display: 'grid' };
const divider = { width: 1, background: '#e1e7f2' };
const searchInput = { width: '100%', border: 0, padding: '22px 20px', fontSize: 18, outline: 'none', color: '#0f172a' };
const searchSelect = { width: '100%', border: 0, padding: '22px 18px', fontSize: 18, outline: 'none', color: '#334155', background: 'transparent' };
const searchBtn = { border: '1px solid #2a3c78', background: '#2e7dff', color: '#fff', padding: '0 34px', fontSize: 18, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 20px rgba(46,125,255,0.28)' };
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };
