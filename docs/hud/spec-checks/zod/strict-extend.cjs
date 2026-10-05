const { z } = require("zod");
const s = z.strictObject({ x: z.number() }).extend({ y: z.number() });
console.log("zod", require("zod/package.json").version, "extend keeps strict:", !s.safeParse({ x: 1, y: 2, q: 3 }).success, "| known fields pass:", s.safeParse({ x: 1, y: 2 }).success);
