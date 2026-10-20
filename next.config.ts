import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingExcludes: { "/*": ["./.agora/**/*"] },
};

export default nextConfig;
