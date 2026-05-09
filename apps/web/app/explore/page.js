import { Suspense } from 'react';
import ExploreClient from './explore-client';

export default function ExplorePage() {
  return (
    <main style={page}>
      <Suspense fallback={null}>
        <ExploreClient />
      </Suspense>
    </main>
  );
}

const page = { minHeight: '100vh', background: '#0b1020' };
