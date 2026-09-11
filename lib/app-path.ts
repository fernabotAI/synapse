const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? '';

export const APP_BASE_PATH = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`
  : '';

export function appPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE_PATH}${normalizedPath}`;
}

export function requestBasePath(request: Request) {
  const pathname = new URL(request.url).pathname;
  const apiMarker = '/api/gmail/';
  const markerIndex = pathname.indexOf(apiMarker);
  return markerIndex >= 0 ? pathname.slice(0, markerIndex) : APP_BASE_PATH;
}

export function publicRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (url.protocol === 'http:' && forwardedProtocol === 'https') url.protocol = 'https:';
  return url.origin;
}

export function publicRequestUrl(request: Request, path: string) {
  return new URL(path, publicRequestOrigin(request));
}

export function redirectResponse(url: URL | string, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: url.toString() },
  });
}
