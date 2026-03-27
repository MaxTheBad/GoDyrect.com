import ListingExplorer from '../../components/ListingExplorer';

export default function ExplorePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'radial-gradient(circle at top right, #ffe7f1 0%, #f8fafc 40%, #f8fafc 100%)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 20px 40px' }}>
        <ListingExplorer />
      </div>
    </main>
  );
}
