import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@cerebro/shared"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
