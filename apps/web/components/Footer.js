export default function Footer(){
  return (
    <footer style={wrap}>
      <div style={inner}>
        <div>© {new Date().getFullYear()} GoDyrect</div>
        <nav style={{display:'flex',gap:12}}>
          <a href="/about" style={link}>About</a>
          <a href="/contactus" style={link}>Contact</a>
          <a href="/legal/privacy" style={link}>Privacy</a>
        </nav>
      </div>
    </footer>
  )
}

const wrap = {
  borderTop: '1px solid #eef2f7',
  background: '#ffffff',
  padding: '18px 0',
  marginTop: 40,
}
const inner = { maxWidth:1120, margin:'0 auto', padding:'0 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }
const link = { color:'#0f172a', textDecoration:'none', fontWeight:600 }
