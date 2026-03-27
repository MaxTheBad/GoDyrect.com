export default function SettingsPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>Settings</h1>
        <p style={{ opacity: 0.85 }}>Manage your account and preferences.</p>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <a href='/profile' style={btn}>Profile Settings</a>
          <a href='/dashboard' style={btn}>Dashboard</a>
          <a href='/legal/privacy' style={btn}>Privacy Policy</a>
        </div>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 700, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const btn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
