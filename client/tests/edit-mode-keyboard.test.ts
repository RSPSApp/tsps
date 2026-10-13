import assert from "node:assert/strict";
import fs from "node:fs";
import { Camera } from "../game/Camera";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { InputManager } from "../game/InputManager";
const dom = new JSDOM('<input><textarea></textarea><input type="checkbox"><div contenteditable="true"></div><button>Place object</button><canvas tabindex="0"></canvas>', { pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, KeyboardEvent: dom.window.KeyboardEvent, self: dom.window });
const canvas = document.querySelector("canvas")!;
const input = new InputManager();
input.init(canvas);
const plugin = new EditModePlugin();
plugin.attach({ getCanvas: () => canvas, getPointerTile: () => undefined, isLoggedIn: () => true, setFreeCamera: () => {}, cancelPendingClick: () => {} } as any);
for (let attempt = 0; attempt < 2; attempt++) {
    document.querySelector("button")!.focus();
    plugin.setConfig({ enabled: true, active: true, tool: "place", locId: 10060 });
    assert.equal(document.activeElement, canvas, "arming and rearming placement focuses the canvas");
    for (const [key, code, keyCode] of [["w", "KeyW", 87], ["a", "KeyA", 65], ["s", "KeyS", 83], ["d", "KeyD", 68], ["ArrowUp", "ArrowUp", 38], ["ArrowDown", "ArrowDown", 40], ["ArrowLeft", "ArrowLeft", 37], ["ArrowRight", "ArrowRight", 39]] as const) {
        document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, code, keyCode, bubbles: true }));
        assert.equal(input.isKeyDown(code), false, `${code} stays out of game and first-person input during placement`);
        document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key, code, keyCode, bubbles: true }));
        assert.equal(input.isKeyDown(code), false);
    }
}
require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const { GameRenderer } = require("../game/GameRenderer");
const camera = new Camera(0, 0, 0, 210, 0);
plugin.setFreeCamera(true);
const renderer = Object.create(GameRenderer.prototype);
renderer.osrsClient = { camera, inputManager: input, cameraSpeed: 4, followPlayerCamera: false,
    editorCameraInput: (deltaTime: number) => plugin.handleCameraInput(camera, deltaTime),
    clientPlugins: { handleCameraKeys: () => { throw new Error("editor input reached first-person camera plugins"); } } };
for (const tool of ["select", "place", "terrain", "path", "wall", "delete"] as const) {
    plugin.setConfig({ tool });
    assert.equal(document.activeElement, canvas, `${tool} arms camera input`);
    document.querySelector("button")!.focus();
    const before = [...camera.pos];
    document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "w", code: "KeyW", keyCode: 87, bubbles: true }));
    assert.equal(document.activeElement, canvas, `${tool} routes navigation from panel buttons back to the canvas`);
    assert.equal(input.isKeyDown("KeyW"), false);
    renderer.handleKeyInput(50);
    const moved = Math.hypot(...camera.pos.map((value: number, i: number) => value - before[i]));
    assert.ok(moved > 0 && moved < 2.4, `${tool} accelerates smoothly using editor input`);
    canvas.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "w", code: "KeyW", keyCode: 87, bubbles: true }));
    assert.equal(input.isKeyDown("KeyW"), false, "navigation release cannot leave game movement held");
    plugin.setFreeCamera(true);
}
for (const selector of ["input:not([type])", "textarea", "[contenteditable=true]"]) {
    const control = document.querySelector<HTMLElement>(selector)!;
    control.tabIndex = 0;
    control.focus();
    control.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "w", code: "KeyW", keyCode: 87, bubbles: true }));
    assert.equal(document.activeElement, control, "typing keeps focus in editor fields");
    assert.equal(input.isKeyDown("KeyW"), false, "typing cannot move the camera");
}
const search = document.querySelector("input")!;
search.focus();
plugin.setConfig({ locId: 590 });
assert.equal(document.activeElement, search, "ordinary config updates preserve typing focus");
plugin.setConfig({ active: false });
input.cleanUp();
dom.window.close();
console.log("Editor placement keyboard tests passed");
