'use client'
import { useEffect, useState } from 'react'
import BottomNav from './BottomNav'
import { usePathname } from 'next/navigation'

export default function MobileBottomNav(){
  const pathname = usePathname()
  const isLanding = ['/', '/landing'].includes(pathname)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(()=>{
    const check = ()=> setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return ()=> window.removeEventListener('resize', check)
  },[])

  if(isLanding && isMobile) return null
  return <BottomNav />
}
