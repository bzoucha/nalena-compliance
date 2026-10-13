import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local file storage lives in .data/ — keep it out of the bundle tracer.
  outputFileTracingExcludes: { "*": [".data/**"] },
};

export default nextConfig;
