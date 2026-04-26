export default function Footer(){
  return (
    <footer style={wrap}>
      <div style={inner}>
        <div style={text}>© {new Date().getFullYear()}</div>
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
  borderTop: '1px solid rgba(255,255,255,0.06)',
  background: '#000',
  padding: '18px 0',
  marginTop: 40,
  color: '#fff'
}
const inner = { maxWidth:1120, margin:'0 auto', padding:'0 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }
const link = { color:'#ffffff', textDecoration:'none', fontWeight:600 }
const text = { color: '#ffffff' }
