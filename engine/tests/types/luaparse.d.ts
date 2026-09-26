// Minimal types for luaparse 0.3.1 (it ships none): only what tests/lua-plugin.test.ts uses.
declare module "luaparse" {
  interface ParseOptions {
    luaVersion?: "5.1" | "5.2" | "5.3" | "LuaJIT";
    comments?: boolean;
    locations?: boolean;
  }
  const luaparse: { parse(code: string, options?: ParseOptions): unknown };
  export = luaparse;
}
