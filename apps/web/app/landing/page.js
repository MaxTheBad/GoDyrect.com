import Link from 'next/link'

export default function Landing() {
  return (
    <main style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'4rem'}}>
      <h1>GoDyrect</h1>
      <p>Welcome — choose your role to contact us</p>
      <div style={{display:'flex',gap:'1rem',marginTop:'2rem'}}>
        <Link href="/contactus?role=owner"><button style={buttonStyle}>Owner</button></Link>
        <Link href="/contactus?role=buyer"><button style={buttonStyle}>Buyer</button></Link>
        <Link href="/contactus?role=broker"><button style={buttonStyle}>Broker</button></Link>
      </div>
      <nav style={{marginTop:'2rem'}}>
        <Link href="/about">About</Link> | <Link href="/contactus">Contact</Link>
      </nav>
    </main>
  )
}

const buttonStyle = {
  padding: '1rem 2rem',
  fontSize: '1rem',
  cursor: 'pointer'
}
