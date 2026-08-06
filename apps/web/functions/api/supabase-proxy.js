const ALLOWED_HEADERS = [
  'accept',
  'accept-profile',
  'apikey',
  'authorization',
  'content-profile',
  'content-type',
  'prefer',
  'range',
  'x-client-info',
  'x-supabase-api-version',
];

export async function onRequest(context) {
  const configuredUrl = context.env.NEXT_PUBLIC_SUPABASE_URL || context.env.SUPABASE_URL;
  if (!configuredUrl) return json({ message: 'Authentication proxy is not configured.' }, 503);

  const incomingUrl = new URL(context.request.url);
  const requestedUrl = incomingUrl.searchParams.get('url');
  if (!requestedUrl) return json({ message: 'Missing target URL.' }, 400);

  let target;
  let allowedOrigin;
  try {
    target = new URL(requestedUrl);
    allowedOrigin = new URL(configuredUrl).origin;
  } catch {
    return json({ message: 'Invalid target URL.' }, 400);
  }

  const allowedPath = /^\/(auth|rest|storage)\/v1\//.test(target.pathname);
  if (target.origin !== allowedOrigin || !allowedPath) {
    return json({ message: 'Target is not allowed.' }, 403);
  }

  const headers = new Headers();
  for (const name of ALLOWED_HEADERS) {
    const value = context.request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = context.request.method.toUpperCase();
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await context.request.arrayBuffer();

  try {
    const upstream = await fetch(target.toString(), { method, headers, body, redirect: 'manual' });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('cache-control', 'no-store');
    responseHeaders.delete('set-cookie');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return json({ message: 'Authentication service is temporarily unavailable.' }, 502);
  }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
