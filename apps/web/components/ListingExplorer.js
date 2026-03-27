'use client';

import { useEffect, useMemo, useState } from 'react';

const sortOptions = ['Newest', 'Oldest', 'Price: Low to High', 'Price: High to Low'];
const businessTypes = ['Established Businesses', 'Asset Sales', 'Real Estate', 'Start-up Businesses'];
const ageOptions = ['0-1 years', '2-5 years', '6-10 years', '10+ years'];

export default function ListingExplorer() {
  const [view] = useState('list');
  const [toast, setToast] = useState('');
  const [openFilter, setOpenFilter] = useState(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const nextViewLabel = useMemo(() => (view === 'list' ? 'Map View (Coming Soon)' : 'List View'), [view]);

  function handleMapSoon() {
    setToast('Map view is coming soon');
    setTimeout(() => setToast(''), 1800);
  }

  function toggleFilter(key) {
    setOpenFilter((curr) => (curr === key ? null : key));
  }

  return (
    <>
      <section style={{ marginTop: 24, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 18 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 30 }}>Buy & sell businesses</h1>
        <p style={{ margin: 0, opacity: 0.86 }}>Search by business name, category, or keywords.</p>

        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr auto auto', gap: 8 }}>
          <input style={{ ...input, width: '100%' }} placeholder='Search business name, categories, keywords' />
          <button style={primaryBtn}>Search</button>
          <button style={ghostBtn} onClick={handleMapSoon}>{nextViewLabel}</button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label style={sortWrap}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>Sort by</span>
            <select style={input} defaultValue='Newest'>
              {sortOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section style={{ marginTop: 16, background: '#121b3f', border: '1px solid #26366d', borderRadius: 16, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          <DropdownFilter title='Business type' isOpen={openFilter === 'type'} onToggle={() => toggleFilter('type')}>
            {businessTypes.map((option) => <label key={option} style={rowLabel}><input type='checkbox' /> {option}</label>)}
          </DropdownFilter>

          <DropdownFilter title='Business age' isOpen={openFilter === 'age'} onToggle={() => toggleFilter('age')}>
            {ageOptions.map((option) => <label key={option} style={rowLabel}><input type='checkbox' /> {option}</label>)}
          </DropdownFilter>

          <DropdownFilter title='Price range' isOpen={openFilter === 'price'} onToggle={() => toggleFilter('price')}>
            <input style={input} placeholder='Min price' />
            <input style={{ ...input, marginTop: 8 }} placeholder='Max price' />
          </DropdownFilter>

          <DropdownFilter title='Quick actions' isOpen={openFilter === 'quick'} onToggle={() => toggleFilter('quick')}>
            <button style={ghostBtn}>Save filter</button>
            <button style={{ ...ghostBtn, marginTop: 8 }}>Reset filter</button>
          </DropdownFilter>
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

const primaryBtn = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const input = { borderRadius: 10, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px', width: '100%' };
const sortWrap = { display: 'grid', gap: 4 };
const dropWrap = { background: '#0f1738', border: '1px solid #26366d', borderRadius: 12, padding: 10 };
const dropBtn = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const rowLabel = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const toastStyle = { position: 'fixed', bottom: 92, right: 20, background: '#1f2d5c', border: '1px solid #3654a8', padding: '10px 14px', borderRadius: 10 };
