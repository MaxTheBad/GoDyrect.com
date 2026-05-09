'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import ListingExplorer from '../../components/ListingExplorer';
import { FeedHero } from '../feed/feed-components';

export default function ExploreClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '');
  const [industry, setIndustry] = useState(searchParams.get('industry') || 'all');
  const initialSearch = searchParams.get('q') || '';
  const initialIndustry = searchParams.get('industry') || 'all';

  function runSearch() {
    const params = new URLSearchParams();
    if (searchDraft.trim()) params.set('q', searchDraft.trim());
    if (industry !== 'all') params.set('industry', industry);
    router.push(`/explore${params.toString() ? `?${params.toString()}` : ''}`);
  }

  return (
    <div style={shell}>
      <FeedHero
        searchDraft={searchDraft}
        setSearchDraft={setSearchDraft}
        industry={industry}
        setIndustry={setIndustry}
        onSearch={runSearch}
        rowsCount={0}
        businessCount={0}
        peopleCount={0}
      />

      <ListingExplorer
        initialSearch={initialSearch}
        initialIndustry={initialIndustry}
      />
    </div>
  );
}

const shell = { display: 'grid', gap: 18 };
