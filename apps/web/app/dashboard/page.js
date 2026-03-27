export default function DashboardPage() {
  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' }}>
      <h1>Dashboard</h1>
      <p>Manage your profile, listings, and messages.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href='/profile' style={btn}>Profile</a>
        <a href='/listings/new' style={btn}>Post Business</a>
        <a href='/messages' style={btn}>Messages</a>
      </div>
    </main>
  );
}

const btn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
