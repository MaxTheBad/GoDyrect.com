const categories = [
  { key: 'established', label: 'Established Businesses' },
  { key: 'asset_sale', label: 'Asset Sales' },
  { key: 'real_estate', label: 'Real Estate' },
  { key: 'startup', label: 'Start-up Businesses' },
];

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>GoDyrect Marketplace</h1>
      <p style={{ opacity: 0.8, marginTop: 0 }}>MVP shell: list/map toggle, sorting, filters, and messaging-ready backend.</p>

      <section style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginTop: 24 }}>
        <button style={btn}>List View</button>
        <button style={btn}>Map View</button>
      </section>

      <section style={{ marginTop: 24, background: '#131a31', padding: 16, borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Filters</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {categories.map((c) => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" /> {c.label}
            </label>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <input placeholder="Min Price" style={input} />
          <input placeholder="Max Price" style={input} />
        </div>

        <div style={{ marginTop: 10 }}>
          <input placeholder="Business age (years)" style={{ ...input, width: '100%' }} />
        </div>

        <div style={{ marginTop: 10 }}>
          <select style={{ ...input, width: '100%' }} defaultValue="newest">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>
      </section>

      <section style={{ marginTop: 24, background: '#131a31', padding: 16, borderRadius: 12 }}>
        <h3 style={{ marginTop: 0 }}>Next Build Steps</h3>
        <ol>
          <li>Connect Supabase auth + profile</li>
          <li>Create listing feed query with filters/sort</li>
          <li>Add favorites and listing detail page</li>
          <li>Add realtime messaging</li>
          <li>Add upload + video edit flow</li>
        </ol>
      </section>
    </main>
  );
}

const btn = {
  background: '#2e7dff',
  color: 'white',
  border: 0,
  borderRadius: 10,
  padding: '12px 16px',
  cursor: 'pointer',
};

const input = {
  borderRadius: 8,
  border: '1px solid #2d3a6b',
  background: '#0f1530',
  color: 'white',
  padding: '10px 12px',
};
