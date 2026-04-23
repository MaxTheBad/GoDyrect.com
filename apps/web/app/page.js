import { redirect } from 'next/navigation';

export default function HomePage() {
  // Serve the landing page at root
  redirect('/landing');
}
