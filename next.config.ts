import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isProduction ? "/cleardraft-local" : "",
  assetPrefix: isProduction ? "/cleardraft-local/" : "",
};

export default nextConfig;
