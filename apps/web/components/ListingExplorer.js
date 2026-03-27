'use client';

import { useMemo, useState } from 'react';

const sortOptions = ['Newest', 'Oldest', 'Price: Low to High', 'Price: High to Low'];
const businessTypes = ['Established Businesses', 'Asset Sales', 'Real Estate', 'Start-up Businesses'];
const ageOptions = ['0-1 years', '2-5 years', '6-10 years', '10+ years'];

export default function ListingExplorer() {
  const [view, setView] = useState('list');
  const [toast, setToast] = useState('');

  const nextViewLabel = useMemo(() => (view === 'list' ? 'Map View' : 'List View'), [view]);

  function toggleView() {
    const next = view === 'list' ? 'map' : 'list';
    setView(next);
    setToast(`Switched to ${next} view`);
    setTimeout(() => setToast(''), 1800);
  }

  return (
    <>
      <section style={{ marginTop: 24, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 18 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 30 }}>Buy & sell businesses</h1>
        <p style={{ margin: 0, opacity: 0.86 }}>Search by business name, category, or keywords.</p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8 }}>
          <input style={{ ...input, width: '100%' }} placeholder='Search business name, categories, keywords' />
          <button style={primaryBtn}>Search</button>
          <button style={ghostBtn} onClick={toggleView}>{nextViewLabel}</button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={chipBtn}>{view === 'list' ? 'List View' : 'Map View'}</span>
          <label style={sortWrap}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>Sort by</span>
            <select style={input} defaultValue='Newest'>
              {sortOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <label style={dropWrap}>
          <span style={dropLabel}>Business type (multi-select)</span>
          <select style={input} multiple size={4}>
            {businessTypes.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>

        <label style={dropWrap}>
          <span style={dropLabel}>Business age (multi-select)</span>
          <select style={input} multiple size={4}>
            {ageOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>

        <label style={dropWrap}>
          <span style={dropLabel}>Min price</span>
          <input style={input} placeholder='e.g. 50000' />
          <span style={{ ...dropLabel, marginTop: 8 }}>Max price</span>
          <input style={input} placeholder='e.g. 3000000' />
        </label>

        <label style={dropWrap}>
          <span style={dropLabel}>Quick actions</span>
          <button style={ghostBtn}>Save filter</button>
          <button style={ghostBtn}>Reset filter</button>
        </label>
      </section>

      {toast ? <div style={toastStyle}>{toast}</div> : null}
    </>
  );
}

const primaryBtn = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const chipBtn = { border: '1px solid #304178', borderRadius: 999, background: '#0e1738', color: '#fff', padding: '8px 12px' };
const input = { borderRadius: 10, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const sortWrap = { display: 'grid', gap: 4 };
const dropWrap = { background: '#121b3f', border: '1px solid #26366d', borderRadius: 12, padding: 12, display: 'grid' };
const dropLabel = { fontSize: 13, opacity: 0.8, marginBottom: 6 };
const toastStyle = {
  position: 'fixed',
  bottom: 20,
  right: 20,
  background: '#1f2d5c',
  border: '1px solid #3654a8',
  padding: '10px 14px',
  borderRadius: 10,
};
