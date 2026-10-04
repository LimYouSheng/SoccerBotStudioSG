import type { NextConfig } from "next";
import { siteBasePath } from "./src/content/site-path";
const config: NextConfig = {
  basePath: siteBasePath,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};
export default config;
