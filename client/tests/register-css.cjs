"use strict";

// CSS imports are resolved by the browser bundler in production. The Node-only component test
// runner registers this no-op loader so importing a UI component does not try to parse CSS as JS.
require.extensions[".css"] = (module) => {
    module.exports = {};
};
