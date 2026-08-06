import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function resilientFetch(input, init) {
  const request = new Request(input, init);

  try {
    return await fetch(request.clone());
  } catch (error) {
    const isSupabaseRequest = supabaseUrl && request.url.startsWith(supabaseUrl);
    const canUseProxy = typeof window !== 'undefined' && isSupabaseRequest;
    if (!canUseProxy) throw error;

    const methodHasBody = !['GET', 'HEAD'].includes(request.method);
    const body = methodHasBody ? await request.arrayBuffer() : undefined;
    return fetch(`/api/supabase-proxy?url=${encodeURIComponent(request.url)}`, {
      method: request.method,
      headers: request.headers,
      body,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  }
}

export const supabase =
  supabaseUrl && supabaseAnon
    ? createClient(supabaseUrl, supabaseAnon, {
        global: { fetch: resilientFetch },
      })
    : null;
