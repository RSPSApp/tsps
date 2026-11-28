import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// A mouse-driven PC with a touchscreen, precision touchpad or pen tablet reports maxTouchPoints > 0, so
// isTouchDevice is true while the main pointer is a fine mouse. The world menu used isTouchDevice for its
// touch rules: a 50-frame cooldown that held back right-click picks (most right-clicks after a menu opened
// no menu) and no auto-close (a stale menu swallowed the next left click). Those rules follow the coarse
// pointer now, like the layout and hover text already do.
const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
    const assert = require("node:assert/strict");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        maxTouchPoints: 2,
    } });
    globalThis.matchMedia = () => ({ matches: false }); // (pointer: coarse) is false: the main pointer is a mouse
    globalThis.window = { location: { search: "" }, matchMedia: globalThis.matchMedia, addEventListener() {} };
    const { isTouchDevice, hasCoarsePointer } = require("./common/utils/DeviceUtil");
    assert.equal(isTouchDevice, true, "touch hardware is present");
    assert.equal(hasCoarsePointer, false, "but the main pointer is fine");
`], { encoding: "utf8", cwd: path.resolve(__dirname, "..") });
assert.equal(result.status, 0, result.stderr || result.stdout);

const check = fs.readFileSync(path.resolve(__dirname, "../render/render/interact/check.ts"), "utf8");
assert.match(check, /const touchMenu = hasCoarsePointer;/, "the world menu's touch rules follow the coarse pointer");
assert.match(check, /touch: touchMenu,/, "the menu cooldown gets the coarse-pointer fact");
assert.match(check, /menuOpen && !picked && !isMouseDown && touchMenu\)/, "menus stay open only on a coarse pointer");
assert.doesNotMatch(check, /\bisTouchDevice\b/, "touch hardware alone does not switch the world menu to touch rules");

console.log("touch-hardware desktop menu: mouse PCs with touch hardware keep desktop menu rules");
