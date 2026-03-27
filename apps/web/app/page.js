import AuthNav from '../components/AuthNav';
import ListingExplorer from '../components/ListingExplorer';

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0a1025 0%, #0f1738 100%)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 20px 40px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: '#2e7dff' }} />
            <strong style={{ fontSize: 20 }}>GoDyrect</strong>
          </div>
          <AuthNav />
        </header>

        <ListingExplorer />
      </div>
    </main>
  );
}
