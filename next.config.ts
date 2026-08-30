import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Every page here is force-dynamic (per-user data behind auth). With the
     * Next 15+ default of `dynamic: 0` the client cache is off entirely, so
     * going Fits → Wardrobe → Fits re-ran the whole server render each time.
     * 30s of reuse makes moving around the app feel instant without ever
     * showing meaningfully stale wardrobe data.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
