import type { NextConfig } from 'next';

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? '';
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`
  : '';

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
