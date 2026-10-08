import type { NextConfig } from "next";

// Workspace packages are consumed as TypeScript source and use NodeNext-style
// "./x.js" specifiers (required by apps/api); map them back to .ts/.tsx.
const nextConfig: NextConfig = {
  transpilePackages: ["@cetem-qc/domain", "@cetem-qc/i18n", "@cetem-qc/api-client"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
