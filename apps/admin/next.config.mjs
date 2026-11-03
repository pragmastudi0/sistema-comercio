/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@comercio/ui', '@comercio/db', '@comercio/business'],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
