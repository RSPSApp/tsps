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
const labels = [...drawer.querySelectorAll("label")].filter((label) => label.querySelector("input"));
assert.deepEqual(labels.map((label) => label.textContent), [
    "Save objects to object-spawns.json", "Render all Height Levels", "Show map icons",
    "PvP zones", "Multi zones", "Duel zones", "Safe zones", "F2P zones",
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
const floorView = drawer.querySelector("select")!;
floorView.value = "one-above";
floorView.dispatchEvent(new dom.window.Event("change"));
assert.equal(plugin.getConfig().floorView, "one-above");
const layout = [...drawer.querySelectorAll("select")].find((select) => [...select.options].some((option) => option.text === "GhostUI"))!;
layout.value = "ghost";
layout.dispatchEvent(new dom.window.Event("change"));
const ghost = document.querySelector<HTMLElement>('[data-map-editor="ghost-navigation"]')!;
assert.equal(ghost.hidden, false);
const dock = document.querySelector('[data-map-editor="ghost-floor-controls"]')!;
const showFloors = dock.querySelector<HTMLSelectElement>('select[aria-label="Show floors"]')!;
const editFloor = dock.querySelector<HTMLSelectElement>('select[aria-label="Editing floor"]')!;
assert.equal(showFloors.selectedOptions[0].textContent, "Through floor 1");
showFloors.value = "all";
showFloors.dispatchEvent(new dom.window.Event("change"));
assert.equal(editFloor.value, "0", "viewing higher floors leaves the editing floor selected");
editFloor.value = "1";
editFloor.dispatchEvent(new dom.window.Event("change"));
assert.equal(showFloors.value, "all", "changing the editing floor keeps the visibility preference");
assert.ok(dock.querySelector('input[aria-label="Show PvP zones"]'));
assert.equal(drawer.querySelector('input[aria-label="Show PvP zones"]'), null);
assert.equal(document.querySelector<HTMLElement>('[data-map-editor="toolbar"]')?.style.display, "none");
const distance = drawer.querySelector<HTMLInputElement>('input[type="range"]')!;
distance.value = "90";
distance.dispatchEvent(new dom.window.Event("input"));
assert.equal(plugin.getConfig().renderDistance, 90);
layout.value = "classic";
layout.dispatchEvent(new dom.window.Event("change"));
assert.equal(ghost.hidden, true);
assert.equal(document.querySelector<HTMLElement>('[data-map-editor="toolbar"]')?.style.display, "flex");
assert.equal(plugin.getConfig().renderDistance, 90, "layout changes keep the editor distance");
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
assert.deepEqual([...document.querySelectorAll('[data-map-editor="settings"] label')]
    .filter((label) => label.querySelector("input")).map(label => label.textContent),
    ["Render all Height Levels", "Show map icons", "PvP zones", "Multi zones", "Duel zones", "Safe zones", "F2P zones"],
    "host-only setting is absent standalone");
standalone.setConfig({ edits: [{ kind: "place", locId: 1, tileX: 64, tileY: 64, plane: 0, shape: 10, rotation: 0 }] });
// Avoid downloading a file; assert the mode at the point the normal export path runs.
standalone.exportModifiedRegionPacks = (saveToJson) => {
    assert.equal(saveToJson, false, "standalone ignores a saved host-only preference");
    packExported = true;
    return [];
};
(document.querySelector('[data-map-editor="top-bar"] button[aria-label="Review and save pending map changes"]') as HTMLButtonElement).click();
(document.querySelector('[data-map-editor="review-changes"] button[aria-label="Download map overrides as a ZIP"]') as HTMLButtonElement).click();
assert.equal(packExported, true);
assert.equal(standalone.getConfig().saveObjectSpawns, true, "export preserves the browser-host preference");
unmountStandalone();
dom.window.close();
console.log("Editor settings drawer tests passed");
