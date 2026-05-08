'use client';

import { useSearchParams } from 'next/navigation';
import ListingExplorer from '../../components/ListingExplorer';

export default function ExploreClient() {
  const searchParams = useSearchParams();
  return <ListingExplorer initialSearch={searchParams.get('q') || ''} initialIndustry={searchParams.get('industry') || 'all'} />;
}
