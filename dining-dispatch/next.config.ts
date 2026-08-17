import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "*": [
      "./restaurant-intelligence/v1/site-data/**",
      "./restaurant-intelligence/v1/enriched/**",
      "./restaurant-intelligence/v1/menus/**",
      "./restaurant-intelligence/v1/registry.json",
      "./restaurant-intelligence/v1/allowlist.json",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "./restaurant-intelligence/archive/**",
      "./restaurant-intelligence/pipeline/**",
      "./restaurant-intelligence/schema/**",
      "./restaurant-intelligence/site-data/**",
    ],
  },
};

export default nextConfig;
