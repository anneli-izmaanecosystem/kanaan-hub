import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Kubernetes deploy (deploy/k8s). Opt-in so the
  // Vercel build is unchanged.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
