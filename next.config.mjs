/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.CHURCH_STANDALONE === "1" ? "standalone" : undefined,
  async redirects() {
    return [{ source: "/", destination: "/login", permanent: false }];
  },
  logging: { incomingRequests: { ignore: [/\/api\/integrations\/google\/callback/] } },
  outputFileTracingExcludes: { "/*": ["./.local/**/*", "./.env*", "./tests/**/*", "./docs/**/*", "./.git/**/*"] },
};

export default nextConfig;
