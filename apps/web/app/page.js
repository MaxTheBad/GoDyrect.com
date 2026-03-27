import ListingExplorer from '../components/ListingExplorer';

export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0a1025 0%, #0f1738 100%)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 20px 40px' }}>
        <ListingExplorer />
      </div>
    </main>
  );
}
