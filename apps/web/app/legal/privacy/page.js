export default function PrivacyPage() {
  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff', maxWidth: 860, margin: '0 auto' }}>
      <h1>GoDyrect Privacy & Terms</h1>
      <p>By creating an account, you agree to our terms and privacy policy.</p>
      <ul>
        <li>We store account/profile information to operate the marketplace.</li>
        <li>Listings and uploaded media may be publicly visible.</li>
        <li>Transactions happen off-platform; users must perform their own due diligence.</li>
        <li>You can request account deletion and data removal.</li>
      </ul>
      <p>Contact: support@godyrect.com</p>
      <a href='/signup' style={{ color: '#8fb7ff' }}>Back to sign up</a>
    </main>
  );
}
