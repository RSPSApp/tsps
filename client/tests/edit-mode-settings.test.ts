import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000", pretendToBeVisual: true });
Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, self: dom.window,
    HTMLAnchorElement: dom.window.HTMLAnchorElement, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
const { mountEditorUi } = require("../game/plugins/editmode/EditorUi");
Object.defineProperty(dom.window, "opener", { configurable: true, value: { closed: false } });
const plugin = new EditModePlugin();
const remove = mountEditorUi(plugin);
const buttons = [...document.querySelectorAll('[role="toolbar"] button')];
const settings = buttons.find((button) => button.getAttribute("aria-label") === "Editor settings") as HTMLButtonElement;
assert(settings, "settings button is on the toolbar");
settings.click();
const drawer = document.querySelector('[data-map-editor="settings"]')!;
assert(drawer);
const labels = [...drawer.querySelectorAll("label")];
assert.deepEqual(labels.map((label) => label.textContent), [
    "Save objects to object-spawns.json", "Render all Height Levels", "Show map icons",
    "PvP zones", "Multi zones", "Duel zones", "Safe zones",
]);
const checkboxes = labels.map((label) => label.querySelector("input")!);
for (const label of labels) {
    assert.equal(label.firstChild, label.querySelector("input"), "checkbox precedes its label");
    assert.equal(label.style.gridTemplateColumns, "16px minmax(0, 1fr)");
    assert.equal(label.style.columnGap, "12px", "all settings use the same gutter");
}
assert.equal(checkboxes[0].checked, false);
checkboxes[0].click();
assert.equal(plugin.getConfig().saveObjectSpawns, true);
checkboxes[1].click();
assert.equal(plugin.getConfig().renderAllHeightLevels, false);
checkboxes[2].click();
assert.equal(plugin.getConfig().showMapIcons, true);
settings.click();
assert.equal(document.querySelector('[data-map-editor="settings"]'), null);
settings.click();
assert.equal(checkboxes[0].checked, true, "reopening preserves settings");
remove();
assert.equal(document.querySelector('[data-map-editor="settings"]'), null);
Object.defineProperty(dom.window, "opener", { configurable: true, value: null });
const standalone = new EditModePlugin({ load: () => ({ saveObjectSpawns: true }), save: () => {} });
let packExported = false;
standalone.attach({
    getPointerTile: () => undefined,
    exportRegionPack: () => { packExported = true; return { regionId: 1, data: new Uint8Array() }; },
} as any);
const unmountStandalone = mountEditorUi(standalone);
(document.querySelector('button[aria-label="Editor settings"]') as HTMLButtonElement).click();
assert.deepEqual([...document.querySelectorAll('[data-map-editor="settings"] label')].map(label => label.textContent), ["Render all Height Levels", "Show map icons", "PvP zones", "Multi zones", "Duel zones", "Safe zones"], "host-only setting is absent standalone");
standalone.setConfig({ edits: [{ kind: "place", locId: 1, tileX: 64, tileY: 64, plane: 0, shape: 10, rotation: 0 }] });
// Avoid downloading a file; assert the mode at the point the normal export path runs.
standalone.exportModifiedRegionPacks = () => {
    assert.equal(standalone.getConfig().saveObjectSpawns, false, "standalone ignores a saved host-only preference");
    packExported = true;
    return [];
};
(document.querySelector('button[aria-label="Download world and map edits"]') as HTMLButtonElement).click();
assert.equal(packExported, true);
unmountStandalone();
dom.window.close();
console.log("Editor settings drawer tests passed");
