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
const buttons = [...document.querySelectorAll('button')];
const settings = buttons.find((button) => button.getAttribute("aria-label") === "Editor settings") as HTMLButtonElement;
assert(settings, "settings button is on the toolbar");
settings.click();
const drawer = document.querySelector('[data-map-editor="settings"]')!;
assert(drawer);
const labels = [...drawer.querySelectorAll("label")].filter((label) => label.querySelector("input"));
assert.deepEqual(labels.map((label) => label.textContent), [
    "Save objects to object-spawns.json", "Render all Height Levels",
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
const mapIcons = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"][aria-label="Show map icons"]')!;
assert.equal(mapIcons.closest('details')!.querySelector('summary')!.textContent, "View");
mapIcons.click();
assert.equal(plugin.getConfig().showMapIcons, true);
assert.equal(mapIcons.getAttribute('aria-checked'), "true");
const viewItems = mapIcons.parentElement!;
assert.equal(viewItems.querySelectorAll('[role="separator"]').length, 2);
const flagToggles = [
    ["Show unwalkable flags", "showUnwalkableFlags"], ["Show bridge flags", "showBridgeFlags"],
    ["Show remove roof flags", "showRemoveRoofFlags"], ["Show render on Z − 1 flag", "showLowerZFlags"],
    ["Show disable render flags", "showDisableRenderFlags"],
] as const;
for (const [label, key] of flagToggles) {
    const toggle = viewItems.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    toggle.click();
    assert.equal(plugin.getConfig()[key], true);
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    plugin.setConfig({ [key]: false });
    assert.equal(toggle.getAttribute("aria-checked"), "false");
}
const lastFlag = viewItems.querySelector('[aria-label="Show disable render flags"]')!;
assert.equal(lastFlag.nextElementSibling?.getAttribute("role"), "separator");
assert.equal(lastFlag.nextElementSibling?.nextElementSibling?.getAttribute("aria-label"), "Show PvP zones");
for (const [label, key] of [["PvP", "showPvpZones"], ["Multi", "showMultiCombatZones"], ["Duel", "showDuelZones"], ["Safe", "showSafeZones"], ["F2P", "showF2pZones"]] as const) {
    const toggle = viewItems.querySelector<HTMLButtonElement>(`[aria-label="Show ${label} zones"]`)!;
    toggle.click();
    assert.equal(plugin.getConfig()[key], true);
    assert.equal(toggle.getAttribute('aria-checked'), "true");
    plugin.setConfig({ [key]: false });
    assert.equal(toggle.getAttribute('aria-checked'), "false", "ticks stay in sync with settings");
}

const floorView = drawer.querySelector("select")!;
floorView.value = "one-above";
floorView.dispatchEvent(new dom.window.Event("change"));
assert.equal(plugin.getConfig().floorView, "one-above");
assert.equal([...drawer.querySelectorAll("select")].some(select => [...select.options].some(option => option.text === "GhostUI")), false);
assert.equal("ghostUi" in plugin.getConfig(), false);
const zPos = document.querySelector<HTMLInputElement>('input[aria-label="Height/Level"]')!;
zPos.value = "1";
zPos.dispatchEvent(new dom.window.Event("change"));
assert.equal(plugin.getConfig().heightLevel, 1);
const distance = drawer.querySelector<HTMLInputElement>('input[type="range"]')!;
distance.value = "90";
distance.dispatchEvent(new dom.window.Event("input"));
assert.equal(plugin.getConfig().renderDistance, 90);
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
    ["Render all Height Levels"],
    "host-only setting is absent standalone");
standalone.setConfig({ edits: [{ kind: "place", locId: 1, tileX: 64, tileY: 64, plane: 0, shape: 10, rotation: 0 }] });
// Avoid downloading a file; assert the mode at the point the normal export path runs.
standalone.exportModifiedRegionPacks = (saveToJson) => {
    assert.equal(saveToJson, false, "standalone ignores a saved host-only preference");
    packExported = true;
    return [];
};
(document.querySelector('[data-map-editor="menu-bar"] button[aria-label="Review changes"]') as HTMLButtonElement).click();
(document.querySelector('[data-map-editor="review-changes"] button[aria-label="Download map overrides as a ZIP"]') as HTMLButtonElement).click();
assert.equal(packExported, true);
assert.equal(standalone.getConfig().saveObjectSpawns, true, "export preserves the browser-host preference");
unmountStandalone();
dom.window.close();
console.log("Editor settings drawer tests passed");
