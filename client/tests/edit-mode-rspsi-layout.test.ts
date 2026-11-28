import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";

const dom = new JSDOM('<!doctype html><div class="game-viewport"><div class="game-canvas-shell" style="top:7px"><canvas></canvas></div></div>', { url: 'http://localhost:3103/?edit', pretendToBeVisual: true });
Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, self: dom.window, HTMLElement: dom.window.HTMLElement, HTMLAnchorElement: dom.window.HTMLAnchorElement, HTMLInputElement: dom.window.HTMLInputElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window)
});
const { mountEditorUi } = require('../game/plugins/editmode/EditorUi');
const plugin = new EditModePlugin({ load: () => ({ ghostUi: false } as any), save: () => { } });
const tile = { tileX: 3200, tileY: 3200, plane: 0 };
let objectUnderPointer: any;
const deletions: unknown[][] = [];
plugin.attach({
    selectPointer: () => objectUnderPointer,
    onLocDel: (...args: unknown[]) => deletions.push(args),
    restoreLoc: () => { },
    getPointerTile: () => tile, getPointerLoc: () => undefined, isLoggedIn: () => true,
    selectTile: () => ({ ...tile, kind: 'tile', locId: -1, shape: 0, rotation: 0 }),
    getTerrainHeight: () => -80, getTerrainFlags: () => 2, getTerrainOverlay: () => 5, getTerrainUnderlay: () => 2,
    getOverlaySwatches: () => [{ id: 5, colorRgb: 0x778899, name: 'Stone', textureId: 1 }, { id: 8, colorRgb: 0x333333, name: 'Road' }],
    getOverlayTexture: () => "data:image/png;base64,AA==",
    getUnderlaySwatches: () => [{ id: 2, colorRgb: 0x225522, name: 'Grass' }],
    getBaseRegionTerrain: () => new Uint8Array(16384), getBaseRegionFlags: () => new Uint8Array(16384).fill(2),
    setTerrainOverlay: () => { }, setTerrainUnderlay: () => { }, setTerrainHeight: () => { }, rebuildScene: () => { },
} as any);
plugin.setConfig({ enabled: true, active: true });
const remove = mountEditorUi(plugin);
const click = (selector: string) => { const button = document.querySelector<HTMLButtonElement>(selector); assert.ok(button, selector); button.click(); };
assert.equal('ghostUi' in plugin.getConfig(), false, 'legacy layout preference cannot restore another mode');
const allHeights = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"][aria-label="Show all height levels"]')!;
assert.ok(allHeights, "RSPSi's height-level toggle is in View");
assert.equal(allHeights.closest('details')!.querySelector('summary')!.textContent, "View");
assert.equal(allHeights.getAttribute('aria-checked'), "true", "all height levels are checked by default");
allHeights.click();
assert.equal(plugin.getConfig().floorView, "up-to", "unchecking hides levels above the current floor");
assert.equal(plugin.getConfig().renderAllHeightLevels, false);
assert.equal(allHeights.getAttribute('aria-checked'), "false");
allHeights.click();
assert.equal(plugin.getConfig().floorView, "all", "checking shows all levels outside buildings");
assert.equal(allHeights.getAttribute('aria-checked'), "true");
plugin.setConfig({ floorView: "all" });
assert.equal(allHeights.getAttribute('aria-checked'), "true", "the tick follows changes made in settings");
plugin.setConfig({ floorView: undefined, renderAllHeightLevels: true });

assert.equal(document.querySelector('[data-map-editor="toolbar"]'), null);
assert.equal(document.querySelector('[data-map-editor="ghost-navigation"]'), null);
assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map(t => t.textContent), ['Objects', 'Overlays', 'Underlays', 'Settlements', 'Misc']);
assert.equal(document.querySelector<HTMLElement>('.game-canvas-shell')!.style.left, '55px');
const menuActions = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
const menuLabels = menuActions.map(button => button.getAttribute('aria-label'));
assert.equal(new Set(menuLabels).size, menuLabels.length, "every dropdown action has one home");
for (const [label, menu] of [["Jump to location", "File"], ["World map", "File"], ["Refresh world data", "File"],
    ["Validate map edits", "File"], ["Stamp area", "Edit"], ["Reset camera angle", "View"],
    ["Brush settings", "Settings"], ["Editor settings", "Settings"], ["Generate structure", "Tools"]]) {
    const button = menuActions.find(button => button.getAttribute('aria-label') === label);
    assert.ok(button, label);
    assert.equal(button.closest('details')!.querySelector('summary')!.textContent, menu, `${label} is grouped under ${menu}`);
}

const railButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-map-editor="tool-rail"] button')];
assert.equal(railButtons.length, 6);
assert.ok(railButtons.every(button => button.querySelector('svg') && button.textContent === ''), "every rail tool uses an icon instead of an abbreviation");
const originalTooltipTimeout = window.setTimeout;
const originalTooltipClear = window.clearTimeout;
let pendingTooltip: (() => void) | undefined;
let tooltipDelay: number | undefined;
window.setTimeout = ((callback: () => void, delay: number) => {
    if (delay !== 120) return originalTooltipTimeout(callback, delay);
    pendingTooltip = callback; tooltipDelay = delay; return 99999;
}) as typeof window.setTimeout;
window.clearTimeout = ((timer?: number) => {
    if (timer === 99999) pendingTooltip = undefined;
    else originalTooltipClear(timer);
}) as typeof window.clearTimeout;
railButtons[0].dispatchEvent(new dom.window.Event('mouseenter'));
assert.equal(tooltipDelay, 120, "tooltips use a short hover delay");
assert.equal(document.querySelector('[role="tooltip"]'), null);
pendingTooltip!();
assert.equal(document.querySelector('[role="tooltip"]')!.textContent, 'Select');
railButtons[0].dispatchEvent(new dom.window.Event('mouseleave'));
assert.equal(document.querySelector('[role="tooltip"]'), null, "leaving a tool removes its tooltip");
railButtons[0].dispatchEvent(new dom.window.Event('focus'));
railButtons[0].dispatchEvent(new dom.window.Event('blur'));
assert.equal(pendingTooltip, undefined, "leaving before the delay cancels the tooltip");
window.setTimeout = originalTooltipTimeout;
window.clearTimeout = originalTooltipClear;

click('[role="tab"][aria-label="Overlays"]');
assert.equal(plugin.getTerrainBrush().action, 'overlay');
click('[data-map-editor="swatches"] [aria-label="Use overlay"]');
const texture = document.querySelector('[data-material="5"] .rspsi-material-preview image')!;
assert.equal(texture.getAttribute('width'), '1', 'texture fills the tile coordinate space');
assert.equal(texture.getAttribute('x'), null, 'texture has no toolbar-icon inset');
click('[data-material="8"]');
assert.equal(plugin.getConfig().overlayId, 8);
assert.ok(document.querySelector('[data-material="8"]'), 'choosing a material keeps the palette open');
assert.equal(document.querySelector('[data-material="8"]')!.getAttribute('aria-pressed'), 'true');
assert.equal(document.querySelector<HTMLElement>('[data-map-editor="overlay-dropdown"]')!.hidden, true, 'picking a paint material closes the dropdown');
click('[data-map-editor="swatches"] [aria-label="Use overlay"]');
const search = document.querySelector<HTMLInputElement>('[aria-label="Search overlays"]')!;
search.value = 'Stone'; search.dispatchEvent(new dom.window.Event('input'));
assert.equal(document.querySelector<HTMLButtonElement>('[data-material="8"]')!.hidden, true);
click('[role="tab"][aria-label="Underlays"]'); click('[data-material="2"]');
assert.equal(plugin.getTerrainBrush().underlay, 2); assert.equal(plugin.getTerrainBrush().action, 'underlay');
assert.equal(document.querySelector('[aria-label="Select Tile"]'), null, "tile selection no longer has a separate rail tool");
assert.equal(document.querySelector('[aria-label="Select Object"]'), null, "object selection no longer has a separate rail tool");
click('[data-map-editor="tool-rail"] [aria-label="Select"]'); plugin.applyAtPointer();
assert.equal(plugin.getSelectionMode(), "entity", "Select picks objects with a tile fallback");
assert.equal(document.querySelector('[data-map-editor="tool-rail"] [aria-label="Select"]')!.getAttribute('aria-pressed'), "true");
plugin.setSelectedTileHeight(20, true);
assert.equal(plugin.getConfig().edits.filter(e => e.kind === 'height').length, 4);
assert.ok(plugin.getConfig().edits.every(e => e.locId === 20));
plugin.setSelectedTileHeight(5, false); assert.ok(plugin.getConfig().edits.slice(-4).every(e => e.locId === 25), 'relative SET uses pending heights');
assert.ok(plugin.undo()); assert.ok(plugin.getConfig().edits.every(e => e.locId === 20), 'one SET is one undo step');
const snapshot = JSON.stringify(plugin.getConfig().edits); plugin.setSelectedTileHeight(NaN, true); assert.equal(JSON.stringify(plugin.getConfig().edits), snapshot);
click('[role="tab"][aria-label="Misc"]');
assert.equal(document.querySelectorAll('[data-map-editor="swatches"] input[type="checkbox"]').length, 0, "Misc has no flag checkboxes");
click('[aria-label="Open terrain flag brush"]');
assert.ok(document.querySelector('[data-map-editor="terrain-brush"] button[aria-label="Flags tools"]'));
assert.equal(document.querySelectorAll('[data-map-editor="terrain-brush"] input[type="checkbox"][aria-label]').length, 5);
const bridgeFlag = document.querySelector<HTMLInputElement>('[data-map-editor="terrain-brush"] input[aria-label="Bridge"]')!;
bridgeFlag.click();
assert.equal(plugin.getTerrainBrush().flagMask, 3, "the checkboxes select which flags to paint");
click('[aria-label="Clear flags"]');
assert.equal(plugin.getTerrainBrush().action, "unblock");
click('[aria-label="Close terrain brush"]');
plugin.setConfig({ tool: "path" }); plugin.applyAtPointer();
const start = plugin.getState().pathStart;
click('[role="tab"][aria-label="Overlays"]'); click('[data-map-editor="swatches"] [aria-label="Use overlay"]'); click('[data-material="5"]');
assert.equal(plugin.getConfig().tool, "path", "material changes keep the line tool active");
assert.deepEqual(plugin.getState().pathStart, start, "material changes preserve the first endpoint");
const beforeDelete = plugin.getConfig().edits;
objectUnderPointer = { ...tile, tileX: 3203, kind: "loc", locId: 50, shape: 0, rotation: 3 };
click('[aria-label="Delete Object"]'); plugin.applyAtPointer();
assert.deepEqual(deletions.at(-1), [{ x: 3203, y: 3200 }, 0, 0, 3], "D_O targets the picked object's origin, shape and direction");
const afterDelete = plugin.getConfig().edits;
objectUnderPointer = { ...tile, kind: "npc", locId: 50 }; plugin.applyAtPointer();
assert.equal(plugin.getConfig().edits, afterDelete, "D_O does not delete an NPC or arbitrary scenery beneath it");
objectUnderPointer = undefined; plugin.applyAtPointer();
assert.equal(plugin.getConfig().edits, afterDelete, "D_O over empty ground writes no edit");
assert.equal(plugin.undo(), true); assert.deepEqual(plugin.getConfig().edits, beforeDelete, "D_O is one undo step");
const resizer = document.querySelector<HTMLElement>('[role="separator"][aria-label="Resize right sidebar"]')!;
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '280px', 'the sidebar starts narrower');
resizer.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, clientX: window.innerWidth - 280, bubbles: true }));
window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: window.innerWidth - 420, bubbles: true }));
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '420px', 'dragging the left edge grows the panel');
window.dispatchEvent(new dom.window.MouseEvent('mouseup', { button: 0 }));
assert.equal(document.body.classList.contains('map-editor-sidebar-resizing'), false);
window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 0 }));
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '420px', 'releasing ends the resize gesture');
resizer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '404px', 'the resize edge also supports keyboard adjustment');
resizer.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, bubbles: true }));
window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: window.innerWidth - 100, bubbles: true }));
window.dispatchEvent(new dom.window.MouseEvent('mouseup', { button: 0 }));
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '240px', 'the panel cannot shrink below usable controls');
click('[aria-label="Close right sidebar"]');
assert.equal(document.body.classList.contains('map-editor-sidebar-collapsed'), true);
click('[aria-label="Open right sidebar"]');
assert.equal(document.body.classList.contains('map-editor-sidebar-collapsed'), false);
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '240px', 'collapse and reopen preserve the resized width');
assert.equal(document.querySelector('.rspsi-bottom label label'), null, 'footer has no nested labels');
click('[role="tab"][aria-label="Settlements"]');
assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent, 'Settlements');
click('[data-map-editor="build-presets"] button[aria-label="Close generate structure"]');
assert.match(document.querySelector('[data-map-editor="swatches"]')!.textContent!, /Generate structure.*Stamp area.*Draw walls/, 'closing a construction inspector restores its tab content');
click('[aria-label="Delete Object"]');
assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent, 'Objects', 'D_O leaves the construction tab');
assert.match(document.querySelector('[data-map-editor="swatches"]')!.textContent!, /Show Object View/, 'D_O never leaves an empty construction dock');
remove();
assert.equal(document.querySelector('.game-canvas-shell')!.getAttribute('style'), 'top:7px');
assert.equal(document.querySelector('[data-map-editor="swatch-dock"]'), null);
assert.equal(document.querySelector('.rspsi-sidebar-resizer'), null);
assert.equal(document.body.style.getPropertyValue('--rspsi-dock-width'), '');
dom.window.close();
console.log('RSPSi layout, material selection, legacy preferences and height controls pass');
