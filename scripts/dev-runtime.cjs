// Console Ninja injects a build hook into locally installed Next.js files.
// In this environment that instrumentation makes PGlite read its PostgreSQL
// catalogs incorrectly. Skip that hook only in this application's dev process;
// the editor extension, user settings and installed dependencies stay unchanged.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function load(specifier, ...args) {
  if (
    typeof specifier === "string" &&
    /[/\\]wallabyjs\.console-ninja-[^/\\]+[/\\]out[/\\]buildHook[/\\]index\.js$/.test(
      specifier,
    )
  ) {
    return { default() {} };
  }
  return originalLoad.call(this, specifier, ...args);
};
