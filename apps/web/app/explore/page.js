import { Suspense } from 'react';
import ExploreClient from './explore-client';

export default function ExplorePage() {
  return (
    <main style={page}>
      <div style={wrap}>
        <Suspense fallback={null}>
          <ExploreClient />
        </Suspense>
      </div>
    </main>
  );
}

const page = { minHeight: '100vh', background: 'radial-gradient(circle at top right, #e7efff 0%, #f8fafc 42%, #f8fafc 100%)' };
const wrap = { maxWidth: 1200, margin: '0 auto', padding: '18px 20px 40px' };
