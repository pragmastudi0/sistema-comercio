/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@comercio/ui', '@comercio/db', '@comercio/business'],
};

export default nextConfig;
