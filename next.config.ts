import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // The compiler API is more reliable than the detached CLI under non-LTS Node builds.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
