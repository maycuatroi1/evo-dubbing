/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["postgres", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]
  }
};

module.exports = nextConfig;
