import { readFileSync } from "node:fs";

// Node scene tests read the same shader sources that the browser bundler imports.
require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
for (const extension of [".png", ".jpg", ".webp"]) {
    require.extensions[extension] = (module, file) => { module.exports = file; };
}
