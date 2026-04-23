import ContactForm from '../../components/ContactForm'
import Link from 'next/link'

export default function ContactPage(){
  return (
    <main style={{padding:'3rem',maxWidth:900,margin:'0 auto'}}>
      <h1>Contact Us</h1>
      <p>Fill out the form and we'll get back to you.</p>
      <ContactForm />
      <p style={{marginTop:20}}>Or <Link href="/landing">return to landing</Link>.</p>
    </main>
  )
}
