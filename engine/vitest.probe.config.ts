// `npm run probe -w engine` (root: `npm run clients:probe`): the client probe, tests\probe\ (ISSUE155_PLAN R5).
// Kept out of `npm test`: it starts real AI clients and takes minutes per client.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/probe/**/*.probe.ts"],
    environment: "node",
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
