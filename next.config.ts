import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Content markdown / starter files are read from the filesystem at runtime.
  outputFileTracingIncludes: {
    "/**": ["./content/**/*"],
  },
  serverExternalPackages: ["modal"],
};

export default nextConfig;
