import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `sharp` is a native module: keep it out of the bundle (Next already does
  // this by default; stated explicitly so it can never regress) ...
  serverExternalPackages: ["sharp"],
  // ... and make sure its prebuilt Linux binaries are traced into the Vercel
  // function for the ONE route that uses it. No other route loads sharp.
  outputFileTracingIncludes: {
    "/api/files/[id]/thumbnail": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
};

export default nextConfig;
