import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    incomingRequests: {
      ignore: [/\/socket\.io/],
    },
  },
};

export default nextConfig;
