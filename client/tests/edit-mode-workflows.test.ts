import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { EditorMapFiles } from "../game/plugins/editmode/EditorMapFiles";
import { EditorWorldMap } from "../game/plugins/editmode/EditorWorldMap";
import { readScatterSets } from "../game/plugins/editmode/EditorScatterSets";
import { buildRegionPack, createRegionPack, parseRegionPack } from "../game/plugins/editmode/RegionPack";
import type { EditModeHost, EditModeSelection, EditModeTile } from "../game/plugins/editmode/types";
import { state as connection } from "../network/serverConnection/state";

test("map tools use the rail and inspector, with cancellable previews", async () => {
    const dom = new JSDOM('<canvas tabindex="0"></canvas>', {
        url: "http://localhost:3000", pretendToBeVisual: true,
    });
    const browser = dom.window;
    const previousUrl = connection.lastUrl;
    connection.lastUrl = "";
    Object.assign(globalThis, {
        window: browser, document: browser.document, self: browser,
        Option: browser.Option, Event: browser.Event, AbortController: browser.AbortController,
        HTMLAnchorElement: browser.HTMLAnchorElement, HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
        requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
        cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    });
    browser.HTMLCanvasElement.prototype.getContext = () => null;
    browser.HTMLCanvasElement.prototype.setPointerCapture = () => {};
    browser.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
    let thumbnailVisible!: (image: HTMLImageElement) => void;
    Object.defineProperty(browser, "IntersectionObserver", { value: class {
        constructor(notify: (entries: { target: HTMLElement; isIntersecting: boolean }[]) => void) {
            thumbnailVisible = (target) => notify([{ target, isIntersecting: true }]);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    } });
    const thumbnailRequests: number[] = [];
    const itemThumbnails: number[] = [];
    const structureRequests: URLSearchParams[] = [];
    const canvas = document.querySelector("canvas")!;
    const tile = { tileX: 3200, tileY: 3200, plane: 0 };
    let hovered = tile;
    let readHeight = (_x: number) => -1;
    const rebuilds: number[][] = [];
    let mapTarget: EditModeTile | undefined;
    let cameraTarget: EditModeTile | undefined;
    let cameraResets = 0;
    let selectedObject: EditModeSelection | undefined;
    const noop = () => {};
    const mainArea = {
        id: 0, regionLowX: 0, regionHighX: 0, regionLowY: 0, regionHighY: 0,
        coord: (x: number, y: number) => x < 64 ? { x: x + 3200, y: y + 3200, plane: 0 } : undefined,
    };
    const namedArea = { ...mainArea, id: 1, externalName: "Test dungeon" };
    const mapState = {
        currentArea: mainArea,
        areasById: new Map([[0, mainArea], [1, namedArea]]),
        displayX: 0, displayY: 0, zoomPercentage: 75, targetX: 20, targetY: 30,
        setCurrentMapAreaId(id: number) {
            this.currentArea = this.areasById.get(id)!;
            this.setDisplayPosition(id, id);
            this.setZoomPercentage(50);
        },
        setCurrentMapAreaAndPosition: noop,
        setDisplayPosition(x: number, y: number) {
            this.displayX = x;
            this.displayY = y;
            this.setWorldMapPositionTarget(-1, -1);
        },
        setZoomPercentage(zoom: number) { this.zoomPercentage = zoom; },
        setWorldMapPositionTarget(x: number, y: number) {
            this.targetX = x;
            this.targetY = y;
        },
    };
    const worldMap = new EditorWorldMap({
        worldMapState: mapState,
        getWorldMapImageTile: () => undefined,
    }, (target) => { mapTarget = target; }, () => undefined, noop, noop, noop, noop);
    const area = JSON.stringify({
        format: "elvarg-map-area", version: 1, origin: { x: 3200, y: 3200 },
        width: 2, height: 2, objects: [{ id: 1, x: 0, y: 0, plane: 0, shape: 10, rotation: 0 }], tiles: [],
    });
    let finishScenerySearch!: () => void;
    const scenerySearch = new Promise<void>((resolve) => { finishScenerySearch = resolve; });
    const plugin = new EditModePlugin();
    plugin.attach({
        getCanvas: () => canvas,
        cancelPendingClick: noop,
        isLoggedIn: () => true, isEditorModalOpen: () => worldMap.isOpen(),
        getPointerTile: () => hovered,
        getPointerLoc: () => undefined,
        projectObject: () => ({ x: 410, y: 240 }),
        onLocDel: noop,
        onLocAddChange: noop,
        selectPointer: () => selectedObject,
        jumpCameraToTile: (target) => { cameraTarget = target; },
        levelCamera: () => { cameraResets++; },
        getLocActions: (id) => id === 52 ? ["Climb-up", "Search"] : id === 50 || id === 51 ? [] : ["Inspect", "Climb"],
        loadObjectTravel: async (object) => object.locId === 52 ? [{ id: 52, op: 1, from: [3200, 3200, 0],
            actionLabel: "Climb-up", mapDerived: true, destinations: [{ label: "Climb up", to: [3201, 3200, 1] }] }] : [],
        getLocName: (id) => id === 51 ? "Cave exit" : "null",
        loadTravel: async (kind) => kind === "map-warps" ? [] : [
            { id: 42, op: 2, name: "Cellar ladder", from: [3200, 3200, 0], destinations: [{ label: "Cellar", to: [3210, 9600, 1] }] },
            { id: 43, op: 2, name: "Return ladder", from: [3210, 9600, 1], destinations: [{ label: "Surface", to: [3200, 3200, 0] }] },
        ],
        getTerrainHeight: ({ tileX }) => readHeight(tileX),
        getTerrainFlags: () => 0,
        setTerrainOverlay: noop,
        clearTerrainOverride: noop,
        getTerrainOverlay: () => plugin.getConfig().edits.findLast(edit => edit.kind === "terrain")?.locId ?? 3,
        getOverlaySwatches: () => [{ id: 3, name: "Stone", colorRgb: 0x777777 }, { id: 7, name: "Grass", colorRgb: 0x306820 }],
        getUnderlaySwatches: () => [{ id: 7, name: "Grass", colorRgb: 0x306820 }],
        refreshEditedRegions: (regions) => rebuilds.push([...regions]),
        getCameraTile: () => cameraTarget ?? tile,
        selectTileRange: (start, end) => ({
            ...start, tileEndX: end.tileX, tileEndY: end.tileY, kind: "ground", locId: -1, locName: "",
        }),
        copyArea: () => area,
        search: async (_kind, name) => {
            await scenerySearch;
            if (name === "marsh") return [{ id: 20, name: "Reeds" }, { id: 21, name: "Log" }];
            return [{ id: 1, name }];
        },
        loadObjectThumbnail: async (id) => { thumbnailRequests.push(id); return "data:image/png;base64,AA=="; },
        loadItemThumbnail: async (id) => { itemThumbnails.push(id); return "data:image/png;base64,AQ=="; },
        loadMapPlans: async () => require("../game/plugins/editmode/generation/buildings/MapPlans").catalog(),
        previewMapPlan: async (query) => { structureRequests.push(query); return JSON.parse(area); },
        getStampObjectInfo: (id) => ({ sizeX: id === 9 ? 2 : 1, sizeY: 1, interactive: true }),
        getLocPlacementShape: () => 10,
        toggleWorldMap: (actions) => worldMap.toggle(tile, actions),
        closeEditorWorldMap: () => worldMap.close(),
    } as EditModeHost);
    plugin.setConfig({ enabled: true, active: true });
    const { mountEditorUi } = require("../game/plugins/editmode/EditorUi");
    const unmount = mountEditorUi(plugin);
    const find = <T extends HTMLElement>(selector: string) => {
        const element = document.querySelector<T>(selector);
        assert.ok(element, selector);
        return element;
    };
    const click = (label: string) => {
        const aliases: Record<string,string> = {"Terrain brush settings":"Modify Height", "Objects":"Place objects", "NPCs":"Place NPCs", "Ground items":"Place ground items", "Choose overlay":"Paint Overlays", "World map":"World map", "Build":"Generate structure", "Refresh map":"Refresh world data", "Select the whole 64 x 64 region":"Select map square", "Choose new map squares on the world map":"Create new map"};
        find<HTMLButtonElement>(`button[aria-label="${aliases[label] ?? label}"]`).click();
    };
    const escape = (target: HTMLElement) => target.dispatchEvent(new browser.KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
    }));
    const panel = (id: string) => `[data-map-editor="${id}"]`;
    const choose = (control: HTMLSelectElement | HTMLInputElement, value: string) => {
        control.value = value;
        control.dispatchEvent(new browser.Event("change", { bubbles: true }));
    };

    try {
        click("Terrain brush settings");
        click("Sculpt tools");
        const action = find<HTMLSelectElement>(`${panel("terrain-brush")} select`);
        action.value = "ramp";
        action.dispatchEvent(new browser.Event("change"));
        assert.equal(plugin.getTerrainBrush().action, "ramp");
        assert.match(find(panel("tool-cue")).textContent!, /Grade ramp · Drag/);
        const selection = find<HTMLSelectElement>('select[aria-label="Selection target"]');
        selection.value = "ground";
        selection.dispatchEvent(new browser.Event("change"));
        assert.equal(plugin.getConfig().tool, "select");
        assert.equal(document.querySelector(panel("terrain-brush")), null);
        plugin.setConfig({ overlayId: 7 });
        plugin.applyAtPointer();
        const currentOverlay = find(panel("current-overlay"));
        assert.ok(currentOverlay.querySelector('svg[aria-label="Current overlay #3"]'), "current overlay preview comes from the selected tile");
        assert.equal(currentOverlay.querySelectorAll("button").length, 1, "only Use is a button in the current-overlay row");
        click("Use current tile overlay");
        assert.equal(plugin.getConfig().overlayId, 3, "Use copies the tile material into the paint selection");
        assert.equal(plugin.getConfig().edits.length, 0, "Use samples without painting the map");
        plugin.setConfig({ overlayId: 7 });
        click("Use overlay");
        const tileOverlays = find(panel("overlay-dropdown"));
        assert.equal(tileOverlays.hidden, false, "Use overlay expands an inline swatch dropdown");
        assert.equal(find<HTMLButtonElement>(`${panel("overlay-dropdown")} button[aria-label="Grass #7"]`).getAttribute("aria-pressed"), "true", "picker previews the paint overlay, not the tile’s existing Stone overlay");
        const overlaySearch = find<HTMLInputElement>('input[aria-label="Search overlays"]');
        overlaySearch.value = "Grass";
        overlaySearch.dispatchEvent(new browser.Event("input"));
        assert.equal(find<HTMLButtonElement>(`${panel("overlay-dropdown")} button[aria-label="Stone #3"]`).hidden, true);
        find<HTMLButtonElement>(`${panel("overlay-dropdown")} button[aria-label="Grass #7"]`).click();
        assert.equal(plugin.getConfig().tool, "select", "changing a tile overlay keeps selection mode");
        assert.ok(plugin.getConfig().edits.some(edit => edit.kind === "terrain" && edit.locId === 7 && edit.tileX === tile.tileX && edit.tileY === tile.tileY));
        assert.equal(find(panel("overlay-dropdown")).hidden, true, "choosing an overlay closes the dropdown");
        click("Use overlay");
        find<HTMLButtonElement>(`${panel("overlay-dropdown")} button[aria-label="Clear #0"]`).click();
        assert.equal(plugin.getConfig().edits.findLast(edit => edit.kind === "terrain")?.locId, 0, "an untextured tile can clear its overlay");
        plugin.setConfig({ overlayId: 3 });
        click("Use current tile overlay");
        assert.equal(plugin.getConfig().overlayId, 0, "Use can sample a tile with no overlay");
        assert.match(find(panel("current-overlay")).textContent!, /None/);

        plugin.undo();
        plugin.undo();
        escape(canvas);


        click("Objects");
        click("Place scenery with a brush");
        assert.equal(plugin.getConfig().tool, "scatter", "the preset arms immediately while its scenery loads");
        plugin.applyAtPointer();
        assert.equal(plugin.getState().selection, undefined, "a click during loading cannot select ground");
        await new Promise<void>((resolve) => setImmediate(resolve));
        click("Place one object at a time");
        finishScenerySearch();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(plugin.getConfig().tool, "select", "an abandoned scenery search cannot take over selection");
        click("Place scenery with a brush");
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(plugin.getConfig().tool, "scatter");
        assert.match(find(panel("tool-cue")).textContent!, /Scatter scenery · Click or drag/);
        const radius = find<HTMLInputElement>(`${panel("object-placement")} input[type="range"]`);
        radius.value = "0";
        radius.dispatchEvent(new browser.Event("change"));
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getConfig().edits.map(({ kind, locId }) => ({ kind, locId })), [{ kind: "place", locId: 1 }]);
        plugin.undo();

        click("Create a scatter set");
        const setName = find<HTMLInputElement>('input[aria-label="Scatter set name"]');
        setName.value = "Marsh edge";
        const search = find<HTMLInputElement>('input[aria-label="Search cache"]');
        search.value = "marsh";
        search.dispatchEvent(new browser.Event("input"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(thumbnailRequests, [], "offscreen search results don't render models");
        const reeds = find<HTMLImageElement>('img[data-loc-thumbnail="20"]');
        thumbnailVisible(reeds);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        assert.deepEqual(thumbnailRequests, [20], "only the visible model is rendered");
        for (const id of [20, 21]) {
            const pick = find<HTMLButtonElement>(`[data-object-result="${id}"] button[data-pick-result]`);
            pick.click();
            assert.equal(pick.getAttribute("aria-pressed"), "true");
        }
        click("Save this scatter set");
        assert.deepEqual(readScatterSets(), [{ name: "Marsh edge", ids: [20, 21] }]);
        assert.equal(find<HTMLSelectElement>('select[aria-label="Scenery set"]').selectedOptions[0].textContent, "Marsh edge");
        plugin.applyAtPointer();
        assert.ok([20, 21].includes(plugin.getConfig().edits[0].locId), "the new set paints its members");
        plugin.undo();

        click("Build");
        click("Wall");
        const wallPanel = find(panel("draw-wall"));
        const [wallMaterial, , opening] = wallPanel.querySelectorAll("select");
        assert.equal(wallMaterial.disabled, true, "wall settings are ready while styles load");
        choose(opening, "gap");
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getState().wallStart, tile);
        hovered = { ...tile, tileX: tile.tileX + 1 };
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getState().wallStart, tile, "a short opening keeps the start tile for another attempt");
        assert.equal(plugin.getConfig().edits.length, 0);
        assert.match(document.body.textContent!, /Wall openings need at least three tiles/);
        hovered = { ...tile, tileX: tile.tileX + 2 };
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getConfig().edits.filter(({ kind }) => kind === "place").map(({ tileX }) => tileX),
            [tile.tileX, tile.tileX + 2], "a longer run includes the selected opening");
        plugin.undo();
        await Promise.resolve();
        assert.equal(wallMaterial.disabled, false);
        assert.equal(opening.value, "gap", "loading styles preserves settings adjusted before the response");
        hovered = tile;
        plugin.applyAtPointer();
        escape(canvas);
        assert.equal(plugin.getState().wallStart, undefined);
        assert.equal(plugin.getConfig().tool, "wall");
        const brushControl = find<HTMLInputElement>('input[aria-label="Brush size"]');
        brushControl.focus();
        escape(brushControl);
        assert.equal(document.querySelector(panel("draw-wall")), null);

        click("Build");
        await Promise.resolve();
        const planPanel = find(panel("build-presets"));
        const field = (label: string) => {
            const element = [...planPanel.querySelectorAll("label")].find(({ firstChild }) => firstChild?.textContent === label);
            assert.ok(element, label);
            return element.querySelector("select")!;
        };
        const structure = field("Structure"), materialStyle = field("Material style");
        const initialPlace = find<HTMLButtonElement>(`${panel("build-presets")} button[aria-label="Place this design on the map"]`);
        assert.equal(initialPlace.disabled, false, "placement can generate its own preview in one click");
        const roll = find<HTMLButtonElement>('button[aria-label="Generate another repeatable design"]');
        assert.ok(roll.querySelector("svg"), "reroll uses an icon");
        assert.equal(roll.textContent, "");
        assert.equal(roll.previousElementSibling?.tagName, "INPUT", "reroll sits beside the design seed input");
        choose(structure, "tavern");
        choose(materialStyle, "warriors-stone");
        choose(structure, "ruins");
        assert.equal(materialStyle.value, "", "an incompatible recipe uses its automatic style");
        choose(structure, "warriors-guild");
        assert.equal(materialStyle.value, "warriors-stone", "the explicitly selected masonry follows compatible recipes");
        click("Preview this structure before placing it");
        await Promise.resolve();
        click("Generate another repeatable design");
        assert.equal(structureRequests.length, 2);
        assert.deepEqual(structureRequests.map((query) => query.get("style")), ["warriors-stone", "warriors-stone"]);
        assert.notEqual(structureRequests[0].get("seed"), structureRequests[1].get("seed"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        const planWidth = find<HTMLInputElement>(`${panel("build-presets")} input[type="number"]`);
        const validWidth = planWidth.value;
        assert.ok(planPanel.querySelector('button[aria-label="Place this design on the map"]'));
        planWidth.value = "";
        planWidth.dispatchEvent(new browser.Event("input"));
        assert.equal(find<HTMLButtonElement>(`${panel("build-presets")} button[aria-label="Place this design on the map"]`).disabled, false,
            "changing settings keeps one-click placement available");
        initialPlace.click();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(plugin.getConfig().edits.length, 0, "invalid dimensions cannot place a stale preview");
        choose(planWidth, "");
        click("Preview this structure before placing it");
        assert.equal(structureRequests.length, 2);
        assert.equal(document.activeElement, planWidth);
        assert.match(planPanel.textContent!, /Use a whole-number width/);
        escape(canvas);
        click("Build");
        await Promise.resolve();
        assert.equal(find<HTMLInputElement>(`${panel("build-presets")} input[type="number"]`).value, validWidth,
            "reopening restores the last valid width");
        click("Preview this structure before placing it");
        await new Promise<void>((resolve) => setImmediate(resolve));
        click("Place this design on the map");
        plugin.applyAtPointer();
        assert.ok(plugin.getConfig().edits.length > 0, "a settlement piece was placed");
        assert.equal(find('[role="tab"][aria-selected="true"]').textContent, "Settlements");
        escape(canvas);
        await Promise.resolve();
        assert.match(find(panel("swatches")).textContent!, /Generate structure.*Stamp area.*Draw walls/,
            "finishing a settlement piece restores useful tab content");
        click("Delete Object");
        assert.equal(find('[role="tab"][aria-selected="true"]').textContent, "Objects");
        assert.match(find(panel("swatches")).textContent!, /Show Object View/);
        assert.equal(plugin.undo(), true);
        assert.equal(plugin.getConfig().edits.length, 0);

        click("Select the whole 64 x 64 region");
        const initialSelection = plugin.getState().selection;
        assert.ok(find(`${panel("selection-details")} details`).textContent?.includes("Region edges"));
        assert.equal(document.querySelector('button[aria-label="Generate building"]'), null, "Build here replaces the legacy generator controls");
        click("Build here");
        await new Promise<void>((resolve) => setImmediate(resolve));
        const placeArea = find<HTMLButtonElement>(`${panel("build-presets")} button[aria-label="Place this design in the selected area"]`);
        assert.equal(placeArea.textContent, "Place on area");
        assert.equal(placeArea.disabled, false, "area placement is available without a separate preview");
        const requestsBeforePlace = structureRequests.length;
        hovered = {...tile, tileX: tile.tileX + 20, tileY: tile.tileY + 20};
        placeArea.click();
        assert.equal(placeArea.disabled, true, "the placement button is busy while generating");
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(structureRequests.length, requestsBeforePlace + 1, "one click generates and places the structure");
        assert.ok(plugin.getConfig().edits.some(edit => edit.kind === "place" && edit.tileX === tile.tileX && edit.tileY === tile.tileY),
            "Place on area uses the captured selection origin, not the current pointer");
        assert.equal(plugin.getConfig().tool, "select", "area placement returns to selection instead of attaching another copy to the cursor");
        assert.equal(plugin.getStamp(), undefined, "area placement disarms the stamp");
        assert.equal(document.querySelector(panel("area-stamps")), null, "area placement closes the stamp inspector");
        assert.equal(plugin.undo(), true, "direct area placement is one undo step");
        hovered = tile;
        click("Duplicate area");
        assert.equal(plugin.getConfig().tool, "stamp");
        assert.equal(plugin.getStamp()?.area.width, 2);
        assert.match(find(panel("tool-cue")).textContent!, /Duplicate area · Click to place/);
        assert.equal(find(panel("selection-details")).style.display, "none");
        escape(canvas);
        assert.equal(plugin.getConfig().tool, "select");
        assert.equal(plugin.getState().selection, initialSelection);
        await Promise.resolve();
        assert.equal(find(panel("selection-details")).style.display, "block");
        assert.equal(plugin.getConfig().edits.length, 0);

        click("Create map square");
        click("Pick a map square visually");
        const worldMapPanel = find(panel("world-map"));
        const map = find<HTMLCanvasElement>(`${panel("world-map")} canvas`);
        for (const event of ["pointerdown", "pointerup"]) {
            const pointer = new browser.MouseEvent(event, {
                clientX: map.width / 2 + 130, clientY: map.height / 2, bubbles: true, cancelable: true,
            });
            Object.defineProperties(pointer, { offsetX: { value: pointer.clientX }, offsetY: { value: pointer.clientY } });
            map.dispatchEvent(pointer);
        }
        assert.equal(document.querySelector(panel("world-map")), null);
        assert.equal(mapTarget, undefined, "picking a new map square does not jump the scene camera");
        const region = find<HTMLInputElement>('input[aria-label="New map square region ID"]');
        assert.equal(region.value, String(51 * 256 + 50), "empty square uses the map area's world-coordinate offset");

        const menuBar = panel("menu-bar");
        assert.equal(document.querySelector('[data-map-editor="toolbar"]'), null, "the old toolbar is removed");
        assert.ok(find(panel("swatch-dock")));

        const pressKey = (target: HTMLElement, key: string, ctrlKey = false) =>
            target.dispatchEvent(new browser.KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }));
        pressKey(canvas, "k", true);
        const finder = find(panel("tool-finder"));
        assert.equal(finder.hidden, false);
        const toolQuery = find<HTMLInputElement>(`${panel("tool-finder")} input`);
        toolQuery.value = "raise hill";
        toolQuery.dispatchEvent(new browser.Event("input"));
        pressKey(toolQuery, "Enter");
        assert.equal(finder.hidden, true);
        assert.equal(plugin.getTerrainBrush().action, "raise");
        assert.equal(find(`${panel("tool-rail")} button[aria-label="Modify Height"]`).getAttribute("aria-pressed"), "true");

        const mouse = (type: string, dx: number) => {
            hovered = { ...tile, tileX: tile.tileX + dx };
            canvas.dispatchEvent(new browser.MouseEvent(type, { button: 0, clientX: 20 + dx * 12, bubbles: true }));
        };
        const heightAt = (dx: number, dy = 0) => plugin.getConfig().edits
            .findLast((edit) => edit.kind === "height" && edit.tileX === tile.tileX + dx && edit.tileY === tile.tileY + dy)?.locId;

        click("Strong brush strength");
        assert.equal(plugin.getTerrainBrush().step, 12);
        mouse("mousedown", 0);
        mouse("mousemove", 3);
        assert.equal(plugin.getConfig().edits.length, 0, "release mode previews without writing");
        mouse("mouseup", 3);
        assert.equal(heightAt(2), 28, "release fills gaps and applies the selected strength");
        assert.equal(plugin.undo(), true);

        const timing = find<HTMLSelectElement>(`${panel("terrain-brush")} select[aria-label="Apply brush"]`);
        timing.value = "live";
        timing.dispatchEvent(new browser.Event("change"));
        mouse("mousedown", 0);
        assert.equal(heightAt(0), 28, "live applies before mouseup");
        mouse("mousemove", 3);
        mouse("mousemove", 0);
        mouse("mousemove", 3);
        await new Promise<void>((resolve) => setTimeout(resolve, 125));
        assert.equal(heightAt(2), 52, "each retraced pass fills gaps and applies strength while holding");
        assert.equal(heightAt(0), 40, "returning over the initial vertex applies another pass");
        assert.equal(plugin.getConfig().edits.filter((edit) => edit.tileX === tile.tileX && edit.tileY === tile.tileY).length, 1);
        mouse("mouseup", 3);
        assert.equal(plugin.undo(), true);
        assert.deepEqual(plugin.getConfig().edits, [], "one undo reverses all batches");
        assert.equal(plugin.redo(), true);
        assert.equal(heightAt(2), 52);
        plugin.undo();

        readHeight = (x) => x === tile.tileX ? -1 : -2;
        click("Flatten to start height");
        click("Medium brush strength");
        mouse("mousedown", 0);
        assert.equal(heightAt(1), 24, "50% blend moves halfway to the sampled start height");
        mouse("mousemove", 3);
        await new Promise<void>((resolve) => setTimeout(resolve, 125));
        assert.equal(heightAt(3), 24, "later live dabs use the initial height and the chosen blend");
        escape(canvas);
        mouse("mouseup", 3);
        assert.deepEqual(plugin.getConfig().edits, [], "Escape rolls back live batches and consumes the release");
        assert.equal(plugin.getConfig().tool, "terrain", "Escape leaves the cancelled brush ready to use again");
        assert.deepEqual(rebuilds.at(-1), [12850], "cancelling restores the built terrain");

        click("Grade ramp");
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.match(document.body.textContent!, /Drag to a second tile to grade a ramp/);
        mouse("mousedown", 0);
        mouse("mousemove", 4);
        assert.deepEqual(plugin.getConfig().edits, [], "the ramp waits until both endpoints have been picked");
        mouse("mouseup", 4);
        assert.equal(heightAt(2), 24, "the ramp blends between both endpoints");
        plugin.undo();

        click("Paint base ground");
        assert.equal(plugin.getTerrainBrush().underlay, undefined);
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.deepEqual(plugin.getConfig().edits, [], "the default base ground brush cannot erase terrain");
        assert.match(document.body.textContent!, /Choose a base ground material before painting/);
        find<HTMLButtonElement>('[data-material="7"]').click();
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.equal(plugin.getConfig().edits[0]?.locId, 7);
        plugin.undo();
        find<HTMLButtonElement>('[data-material="0"]').click();
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.equal(plugin.getConfig().edits[0]?.locId, 0, "clearing base ground is an explicit choice");
        plugin.undo();
        escape(canvas);
        assert.equal(plugin.getConfig().tool, "select", "Escape stops the idle brush");
        assert.equal(document.querySelector(panel("terrain-brush")), null);

        click("Set flags");
        mouse("mousedown", 0);
        assert.equal(plugin.getConfig().edits[0].kind, "flag");
        mouse("mousemove", 2);
        browser.dispatchEvent(new browser.Event("blur"));
        assert.equal(plugin.getConfig().edits.length, 3, "losing focus finishes the visible live gesture");
        pressKey(canvas, "]");
        assert.equal(plugin.getTerrainBrush().radius, 1, "the radius shortcut works on the canvas");
        assert.match(find(panel("terrain-brush")).textContent!, /Brush radius: 1 tile/);
        find<HTMLButtonElement>(`${menuBar} button[aria-label="Review changes"]`).click();
        assert.match(find(panel("review-changes")).textContent!, /Region 12850.*3 edited ground points/);
        find<HTMLButtonElement>(`${menuBar} button[aria-label="Undo"]`).click();
        assert.match(find(panel("review-changes")).textContent!, /No unsaved changes/);
        find<HTMLButtonElement>(`${menuBar} button[aria-label="Redo"]`).click();
        assert.equal(plugin.getConfig().edits.length, 3);
        click("Jump to changes at 3201, 3200, 0");
        assert.deepEqual(cameraTarget, { ...tile, tileX: 3201 }, "review jumps to an actual edited tile, even off-centre");

        const task = (label: string) => find<HTMLButtonElement>(`${menuBar} button[aria-label="${label === "Select objects and NPCs" ? "Select" : label}"]`).click();
        task("Paint overlay");
        assert.equal(find<HTMLButtonElement>('[role="tab"][aria-label="Overlays"]').getAttribute("aria-selected"), "true");
        assert.ok(document.querySelector(panel("swatches")));
        assert.equal(plugin.getConfig().tool, "terrain");

        task("Draw path");
        assert.ok(document.querySelector(panel("terrain-line-tool")));

        task("Place objects");
        assert.equal(document.querySelector(panel("terrain-line-tool")), null, "switching to placement closes the path inspector");

        task("Select objects and NPCs");
        assert.equal(plugin.getSelectionMode(), "entity");
        selectedObject = { ...tile, kind: "loc", locId: 50, locName: "Decorative rock", shape: 22, rotation: 3 };
        plugin.applyAtPointer();
        assert.equal(document.querySelector(panel("object-actions")), null, "object actions only appear in the sidebar");
        const objectActions = find(panel("selection-details"));
        const clipboardEvent = (name: "cut" | "copy" | "paste", text = "", target: HTMLElement = canvas) => {
            const event = new browser.Event(name, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
            return target.dispatchEvent(event);
        };
        assert.equal(clipboardEvent("cut"), true);
        assert.equal(clipboardEvent("copy"), true);
        assert.equal(clipboardEvent("paste", "Old object name"), true);
        assert.equal(plugin.getConfig().tool, "select");
        assert.equal(plugin.getState().selection, selectedObject);
        const editsBeforeObjectPlacement = plugin.getConfig().edits;
        click("Duplicate object");
        assert.equal(plugin.getConfig().tool, "place");
        assert.equal(plugin.getConfig().shape, 22);
        assert.equal(plugin.getConfig().rotation, 3);
        pressKey(canvas, "Delete");
        assert.deepEqual(plugin.getConfig().edits, editsBeforeObjectPlacement, "Delete cannot act on a previous selection during placement");
        hovered = { ...tile, tileX: tile.tileX + 2 };
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getConfig().edits.at(-1), { ...hovered, kind: "place", locId: 50, shape: 22, rotation: 3 });
        plugin.undo();
        task("Select objects and NPCs");
        click("Move object");
        assert.equal(plugin.getConfig().tool, "place");
        assert.deepEqual(plugin.getConfig().edits, editsBeforeObjectPlacement, "Move waits for a destination");
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getConfig().edits.slice(-2), [
            { ...tile, kind: "delete", locId: 0, shape: 22, rotation: 3 },
            { ...hovered, kind: "place", locId: 50, shape: 22, rotation: 3 },
        ]);
        plugin.undo();
        assert.deepEqual(plugin.getConfig().edits, editsBeforeObjectPlacement);
        const middle = (target: HTMLElement, type: "mouseup" | "auxclick") => target.dispatchEvent(new browser.MouseEvent(type, {
            button: 1, bubbles: true, cancelable: true,
        }));
        const nativeInput = document.createElement("input");
        objectActions.append(nativeInput);
        for (const type of ["mouseup", "auxclick"] as const) {
            assert.equal(middle(canvas, type), false, "the canvas consumes the browser's middle-click default");
            assert.equal(middle(objectActions, type), false, "editor controls consume the same default");
            assert.equal(middle(nativeInput, type), true, "text fields retain middle-click paste");
        }
        assert.equal(clipboardEvent("paste", area, nativeInput), true);
        nativeInput.remove();
        let reachedGameInput = false;
        canvas.addEventListener("keydown", () => { reachedGameInput = true; }, { once: true });
        assert.equal(pressKey(canvas, "v", true), true, "the browser keeps its paste default action");
        assert.equal(reachedGameInput, false, "canvas game input cannot swallow Ctrl+V");
        assert.equal(clipboardEvent("paste", area), false);
        assert.equal(plugin.getStamp()?.area.width, 2, "valid map areas still paste into a placement preview");
        escape(canvas);
        hovered = tile;
        selectedObject = undefined;

        task("Tiles only");
        plugin.applyAtPointer();
        assert.equal(find(panel("selection-details")).style.display, "block");
        task("Buildings");
        assert.equal(find(panel("selection-details")).style.display, "none", "ground inspector closes when switching to building selection");
        task("Select");
        selectedObject = { ...tile, kind: "loc", locId: 42, locName: "Cellar ladder" };
        plugin.applyAtPointer();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.ok(find(panel("travel-links")));
        assert.ok(find(panel("travel-links")).textContent!.includes("3210, 9600, 1"), "object overview shows the current destination");
        assert.equal(find('[data-map-editor="travel-nearby"]').hidden, true, "nearby links hide while inspecting an object");
        click("Change destination for Climb");
        click("Back to action");
        assert.equal(find<HTMLSelectElement>(`${panel("travel-links")} select[aria-label="Source object option"]`).value, "2");
        click("Review");
        click("Move the camera to this arrival tile");
        assert.deepEqual(cameraTarget, { tileX: 3210, tileY: 9600, plane: 1 });
        click("Return to the travel link list");
        assert.equal(find('[data-map-editor="travel-nearby"]').hidden, false, "browsing restores nearby links");
        click("Go to Return ladder at 3210, 9600, 1");
        assert.match(find(panel("travel-links")).textContent!, /Return ladder/);

        task("Pick source object");
        selectedObject = { ...tile, kind: "loc", locId: 52, locName: "Ladder" };
        plugin.applyAtPointer();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.match(find(panel("travel-links")).textContent!, /Climb-up.*3201, 3200, 1/,
            "map-derived ladder routes appear alongside the object's other actions");
        assert.equal(find('[data-map-editor="travel-nearby"]').hidden, true);
        click("Change destination for Climb-up");
        const destinationInput = [...document.querySelectorAll<HTMLLabelElement>(`${panel("travel-links")} label`)]
            .find(label => label.textContent === "Destination 1 coordinates")!.querySelector("input")!;
        destinationInput.value = "3202, 3200, 1";
        destinationInput.dispatchEvent(new browser.Event("input", { bubbles: true }));
        click("Continue to return link");
        click("Continue to review");
        assert.match(find(panel("travel-links")).textContent!, /Climb-up.*3202, 3200, 1/,
            "changing the destination preserves the existing action");
        click("Back to object actions");
        click("Add a travel action to this object");
        assert.equal(find<HTMLSelectElement>(`${panel("travel-links")} select[aria-label="Source object option"]`).value, "3",
            "adding an action uses an empty slot instead of overwriting Climb-up or Search");
        task("Pick source object");
        selectedObject = { ...tile, kind: "loc", locId: 50, locName: "null" };
        plugin.applyAtPointer();
        assert.match(find(panel("travel-links")).textContent!, /Scenery #50/);
        await new Promise<void>((resolve) => setImmediate(resolve));
        click("Add a travel action to this object");
        click("Use action text Climb down");
        click("Continue to destination");
        click("Pick an arrival object");
        hovered = { ...tile, tileX: tile.tileX + 5 };
        selectedObject = { ...hovered, kind: "loc", locId: 51, locName: "Cave exit" };
        plugin.applyAtPointer();
        click("Continue to return link");
        click("Use the arrival object as the way back");
        click("Continue to review");
        assert.match(find(panel("travel-links")).textContent!, /Climb down.*Two-way.*Climb up/);
        click("Include this link in the next map save");
        click("Go to return object");
        click("Return to the travel link list");
        click("Go to Cave exit at 3205, 3200, 0");
        assert.match(find(panel("travel-links")).textContent!, /Climb up.*Two-way.*Climb down/);
        click("Return");
        click("Make this route one-way");
        click("Continue to review");
        click("Include this link in the next map save");
        assert.match(find(panel("travel-links")).textContent!, /Climb up.*One-way/);
        assert.equal(document.querySelector('button[aria-label="Go to Object 50 at 3200, 3200, 0"]'), null, "the paired entrance is removed");
        hovered = tile;

        const dock = panel("menu-bar");
        assert.equal(document.querySelector(`${menuBar} button[aria-label="Navigate"]`), null);
        const mapButton = find<HTMLButtonElement>(`${dock} button[aria-label="World map"]`);
        mapButton.focus();
        mapButton.click();
        assert.equal(mapButton.getAttribute("aria-pressed"), "true");
        assert.ok(document.querySelector(panel("travel-links")), "browsing the map preserves the current workspace");
        assert.equal(mapState.targetX, 20, "opening the raw map does not change the regular world map");
        const layer = find<HTMLSelectElement>(`${panel("world-map")} select[aria-label="Map layer"]`);
        choose(layer, "1");
        assert.equal(mapState.currentArea, namedArea);
        assert.equal(find<HTMLSelectElement>(`${panel("world-map")} select[aria-label="Floor"]`).parentElement!.hidden, true);
        pressKey(document.activeElement as HTMLElement, "Escape");
        assert.equal(document.querySelector(panel("world-map")), null);
        assert.equal(mapButton.getAttribute("aria-pressed"), "false");
        assert.equal(document.activeElement, mapButton);
        assert.equal(mapState.currentArea, mainArea);
        assert.deepEqual([mapState.displayX, mapState.displayY, mapState.zoomPercentage, mapState.targetX, mapState.targetY],
            [0, 0, 75, 20, 30], "closing named areas restores the regular world map");
        click("Jump to location");
        click("Choose on world map");
        assert.equal(document.querySelector(panel("jump-to-location")), null, "choosing visually closes the coordinate form");
        const navigationMap = find<HTMLCanvasElement>(`${panel("world-map")} canvas`);
        mapTarget = undefined;
        pressKey(navigationMap, "Enter");
        assert.ok(mapTarget, "choosing a world map location navigates the editor camera");
        assert.equal(document.querySelector(panel("world-map")), null, "choosing a location closes the map");
        find<HTMLButtonElement>(`${dock} button[aria-label="Reset camera angle"]`).click();
        assert.equal(cameraResets, 1);

        task("Draw path");
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getState().pathStart, tile);
        pressKey(canvas, "k", true);
        const navigationSearch = find<HTMLInputElement>(`${panel("tool-finder")} input`);
        navigationSearch.value = "world map";
        navigationSearch.dispatchEvent(new browser.Event("input"));
        pressKey(navigationSearch, "Enter");
        const rawLayer = find<HTMLSelectElement>(`${panel("world-map")} select[aria-label="Map layer"]`);
        choose(rawLayer, "caves");
        const center = [...find(panel("world-map")).querySelectorAll("button")].find(({ textContent }) => textContent === "Center on editor");
        assert.ok(center);
        center.click();
        assert.equal(rawLayer.value, "surface", "centering on the editor restores its map layer");
        choose(rawLayer, "caves");
        const caveCanvas = find<HTMLCanvasElement>(`${panel("world-map")} canvas`);
        pressKey(caveCanvas, "ArrowRight");
        pressKey(caveCanvas, "Enter");
        assert.deepEqual(mapTarget, { tileX: 3216, tileY: 9600, plane: 0 }, "keyboard panning navigates within raw cave coordinates");
        assert.deepEqual(plugin.getState().pathStart, tile, "opening the map keeps the pending path");

        pressKey(canvas, "k", true);
        navigationSearch.value = "jump";
        navigationSearch.dispatchEvent(new browser.Event("input"));
        pressKey(navigationSearch, "Enter");
        const jump = find<HTMLInputElement>(`${panel("jump-to-location")} input`);
        const jumpForm = jump.form!;
        jump.value = "invalid";
        jumpForm.dispatchEvent(new browser.Event("submit", { cancelable: true }));
        assert.equal(jump.getAttribute("aria-invalid"), "true");
        assert.deepEqual(plugin.getState().pathStart, tile);
        jump.value = "3202, 3203, 2";
        jumpForm.dispatchEvent(new browser.Event("submit", { cancelable: true }));
        assert.deepEqual(cameraTarget, { tileX: 3202, tileY: 3203, plane: 2 });
        assert.equal(find<HTMLInputElement>('input[aria-label="Height/Level"]').value, "2");
        assert.equal(plugin.getConfig().tool, "path");
        assert.equal(plugin.getState().pathStart, undefined, "jumping clears the old path endpoint");
        assert.equal(document.querySelector(panel("jump-to-location")), null);
        plugin.setConfig({ heightLevel: 0 });

        assert.ok(document.querySelector(`${menuBar} button[aria-label="Refresh world data"]`));
        task("Create new map");
        const picker = find(panel("world-map"));
        const pickCanvas = find<HTMLCanvasElement>(`${panel("world-map")} canvas`);
        pressKey(pickCanvas, "Enter");
        const chooseTerrain = [...picker.querySelectorAll("button")].find(({ textContent }) => textContent === "Choose terrain")!;
        assert.ok(chooseTerrain.disabled, "pending edits make a square unavailable for generation");
        pressKey(pickCanvas, "Escape");

        task("Place ground items");
        const itemSearch = find<HTMLInputElement>(`${panel("search")} input[aria-label="Search cache"]`);
        itemSearch.value = "Pickaxe";
        itemSearch.dispatchEvent(new browser.Event("input"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        const icon = find<HTMLImageElement>('img[data-asset-kind="item"][data-asset-thumbnail="1"]');
        assert.deepEqual(itemThumbnails, [], "item previews are lazy too");
        thumbnailVisible(icon);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        assert.deepEqual(itemThumbnails, [1]);
        assert.equal(icon.src, "data:image/png;base64,AQ==");

        plugin.setConfig({ heightLevel: 0 });
        assert.equal(plugin.getBrushTiming(), "live");
        assert.equal(plugin.getConfig().edits.length, 3, "navigation preserves pending world edits");

        plugin.clearEdits();
        plugin.armScatter([9], 0, 0.6);
        const random = Math.random;
        Math.random = () => 0;
        try {
            const placements = () => plugin.getConfig().edits.filter((edit) => edit.kind === "place");
            mouse("mousedown", 0);
            assert.equal(placements().length, 1, "scenery is placed on press in live mode");
            mouse("mousemove", 3);
            await new Promise<void>((resolve) => setTimeout(resolve, 125));
            assert.deepEqual(placements().map((edit) => edit.tileX), [tile.tileX, tile.tileX + 2],
                "a later batch respects the full footprint of already placed objects");
            mouse("mouseup", 3);
            assert.equal(plugin.undo(), true);
            assert.deepEqual(placements(), []);
            assert.equal(plugin.redo(), true);
            assert.equal(placements().length, 2);
        } finally {
            Math.random = random;
        }

    } finally {
        worldMap.close();
        unmount();
        plugin.setConfig({ active: false });
        connection.lastUrl = previousUrl;
        browser.close();
    }
});

test("landscape drafts can be rerolled, loaded in game, and edited again after saving", async () => {
    const dom = new JSDOM("<canvas></canvas>", { url: "http://localhost:3000/?edit", pretendToBeVisual: true });
    const browser = dom.window;
    Object.assign(globalThis, {
        window: browser, document: browser.document, self: browser,
        Option: browser.Option, Event: browser.Event, AbortController: browser.AbortController,
        HTMLAnchorElement: browser.HTMLAnchorElement, HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement,
        requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
        cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    });
    const outlines: number[][] = [];
    const mapContext = {
        lineWidth: 1, strokeStyle: "",
        createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
        fillRect: () => {}, beginPath: () => {}, arc: () => {}, fill: () => {},
        strokeRect(x: number, y: number, w: number, h: number) {
            if (this.strokeStyle === "#60a5fa") outlines.push([x, y, w, h]);
        },
    };
    browser.HTMLCanvasElement.prototype.getContext = () => mapContext as any;
    browser.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    const worldMap = new EditorWorldMap({
        worldMapState: {
            displayX: 0, displayY: 0, setCurrentMapAreaId: () => {},
            setCurrentMapAreaAndPosition: () => {}, setDisplayPosition: () => {},
        },
        getWorldMapImageTile: () => undefined,
    }, () => {}, () => undefined, () => {}, () => {}, () => {}, () => {});
    browser.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    const land = require("../game/plugins/editmode/generation/landscapes/LandscapePlans");
    const id = 19765;
    const tile = { tileX: (id >> 8) * 64, tileY: (id & 255) * 64, plane: 0 };
    const originalFetch = globalThis.fetch;
    const previousUrl = connection.lastUrl;
    const open = EditorMapFiles.open;
    const supported = EditorMapFiles.supported;
    const saved: { paths: string[]; additions: string[] }[] = [];
    const reloads: number[][] = [];
    const seenSeeds: number[] = [];
    let visible: Uint8Array | undefined;
    let scenePreview: Uint8Array | undefined;
    const framed: EditModeTile[] = [];
    connection.lastUrl = "ws://localhost:3000";
    globalThis.fetch = async () => { throw new Error("landscape UI must not use HTTP"); };
    const landscapeData = async (part = "") => {
        const { pathname, searchParams } = new URL(part || "/", "https://editor.invalid");
        const seed = Number(searchParams.get("seed"));
        if (pathname === "/occupied") return [];
        if (pathname === "/scene") {
            assert.equal(searchParams.get("squares"), String(id));
            seenSeeds.push(seed);
            return { width: 64, height: 64, regions: [id], occupied: [], sceneryCount: 0,
                preview: { columns: 1, rows: 1, pixels: "AAAA", colours: ["#000000"] },
                packs: [{ regionId: id, data: createRegionPack(id, true, 7 + seenSeeds.length, false) }] };
        }
        assert.equal(pathname, "/");
        return land.catalog();
    };
    EditorMapFiles.supported = () => true;
    EditorMapFiles.open = async () => ({
        checkLoadedRegion: async () => {},
        save: async (files: ReadonlyMap<string, Blob>, additions: ReadonlySet<string>) => {
            saved.push({ paths: [...files.keys()], additions: [...additions] });
        },
    } as unknown as EditorMapFiles);
    const plugin = new EditModePlugin();
    const noop = () => {};
    plugin.attach({
        getCanvas: () => document.querySelector("canvas"),
        isLoggedIn: () => true,
        getPointerTile: () => tile, getCameraTile: () => ({ ...tile, tileX: tile.tileX + 32, tileY: tile.tileY + 32 }),
        toggleWorldMap: (actions) => worldMap.toggle({ ...tile, tileX: tile.tileX + 32, tileY: tile.tileY + 32 }, actions),
        closeEditorWorldMap: () => worldMap.close(),
        isEditorModalOpen: () => worldMap.isOpen(),
        landscapeData,
        levelCamera: noop, jumpCameraToTile: noop, setFreeCamera: noop,
        isRegionOccupied: () => !!visible,
        showLandscapePreview: (packs) => { scenePreview = packs[0]?.data; },
        frameLandscape: (tile) => { framed.push(tile); },
        previewNewRegion: (data) => { visible = data; },
        removeNewRegion: () => { visible = undefined; },
        markMapEditsSaved: (packs) => { visible = packs[0]?.data; },
        reloadSavedRegions: (regions) => { reloads.push([...regions]); },
        exportRegionPack: (_tile, edits) => {
            const base = parseRegionPack(visible!);
            return { regionId: id, data: buildRegionPack(id, -1, -1, base.objectData, base.terrainData, edits, true, true, true) };
        },
    } as EditModeHost);
    plugin.setConfig({ enabled: true, active: true });
    const { mountEditorUi } = require("../game/plugins/editmode/EditorUi");
    const unmount = mountEditorUi(plugin);
    const fileSaver = require("file-saver");
    const saveAs = fileSaver.saveAs;
    const downloads: { contents: Blob; name: string }[] = [];
    fileSaver.saveAs = (contents: Blob, name: string) => { downloads.push({ contents, name }); };
    const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const click = (label: string) => {
        const element = button(label);
        assert.ok(element, label);
        assert.equal(element.disabled || element.hidden, false, label);
        element.click();
    };
    const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
    const waitForPreview = async () => {
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
            if (button("Keep this terrain as an unsaved map draft")?.disabled === false) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        assert.fail(document.querySelector('[data-map-editor="landscape"] [role="status"]')?.textContent ?? "Landscape preview did not become ready");
    };
    try {
        const worldCanvas = () => document.querySelector<HTMLCanvasElement>('[data-map-editor="world-map"] canvas')!;
        const keyboard = (key: string, ctrlKey = false) =>
            worldCanvas().dispatchEvent(new browser.KeyboardEvent("keydown", { key, ctrlKey, bubbles: true }));
        const hover = async () => {
            outlines.length = 0;
            const event = new browser.MouseEvent("pointermove", { bubbles: true });
            Object.defineProperties(event, { offsetX: { value: 300 }, offsetY: { value: 200 } });
            worldCanvas().dispatchEvent(event);
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            return outlines.at(-1)?.[2];
        };
        worldMap.toggle({ ...tile, tileX: tile.tileX + 32, tileY: tile.tileY + 32 }, { mode: "navigate" });
        assert.equal(await hover(), 192, "navigation outlines the hovered map square");
        for (let i = 0; i < 18; i++) keyboard("-");
        assert.equal(await hover(), 8, "navigation can zoom out to an eight-pixel square");
        worldMap.close();

        let picked: readonly number[] | undefined;
        const start = { ...tile, tileX: tile.tileX + 32, tileY: tile.tileY + 32 };
        worldMap.toggle(start, {
            mode: "footprint", expand: true,
            loadOccupiedSquares: async () => [id - 256],
            selectFootprint: (footprint) => { picked = footprint.regions; },
        });
        await settled();
        assert.equal(await hover(), 48);
        keyboard("Enter");
        keyboard("ArrowRight");
        keyboard("Enter", true);
        keyboard("ArrowUp");
        keyboard("Enter", true);
        [...document.querySelectorAll<HTMLButtonElement>('[data-map-editor="world-map"] button')]
            .find(({ textContent }) => textContent === "Choose terrain")!.click();
        assert.deepEqual(picked, [id, id + 256, id + 257], "the picker preserves an L-shaped extension");
        click("Create new map");
        await settled();
        const picker = document.querySelector('[data-map-editor="world-map"]')!;
        picker.querySelector("canvas")!.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const chooseTerrain = [...picker.querySelectorAll("button")].find(({ textContent }) => textContent === "Choose terrain")!;
        assert.equal(chooseTerrain.disabled, false);
        chooseTerrain.click();
        await waitForPreview();
        assert.deepEqual(framed, [start], "the camera frames the selected map square");
        assert.ok(scenePreview, "the preview sends real terrain to the viewport");
        assert.equal(plugin.exportModifiedRegionPacks().length, 0, "preview terrain cannot be saved");
        assert.equal(plugin.isNewMapSquare(id), false);
        const beforeReroll = scenePreview;
        const layout = document.querySelector<HTMLElement>('[data-map-editor="landscape"] select')!;
        const slider = document.querySelector<HTMLElement>('[data-map-editor="landscape"] input[type="range"]')!;
        const cameraKey = (target: HTMLElement) => {
            target.focus();
            const event = new browser.KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true, cancelable: true });
            target.dispatchEvent(event);
            target.dispatchEvent(new browser.KeyboardEvent("keyup", { key: "w", code: "KeyW", bubbles: true }));
            return event.defaultPrevented;
        };
        assert.equal(cameraKey(layout), true, "a focused dropdown still lets WASD move the camera");
        assert.equal(cameraKey(slider), true, "a focused slider still lets WASD move the camera");
        click("Preview another landscape at this location");
        await waitForPreview();
        assert.notDeepEqual(scenePreview, beforeReroll);
        assert.equal(framed.length, 1, "rerolling keeps the current camera view");
        click("Keep this terrain as an unsaved map draft");
        await settled();
        const original = visible;
        assert.ok(original);
        assert.equal(scenePreview, undefined);
        assert.equal(plugin.isNewMapSquare(id), true);
        assert.equal(saved.length, 0, "generation stays in the editor");
        assert.equal(downloads.length, 0);
        click("Reroll map draft");
        await settled();
        click("Preview another landscape at this location");
        await waitForPreview();
        const panel = document.querySelector('[data-map-editor="landscape"]')!;
        panel.querySelector<HTMLButtonElement>("button")!.click();
        assert.equal(scenePreview, undefined, "closing clears a reroll preview");
        assert.deepEqual(visible, original, "closing a reroll keeps the prior draft");
        click("Reroll map draft");
        await settled();
        click("Preview another landscape at this location");
        await waitForPreview();
        click("Keep this terrain as an unsaved map draft");
        await settled();
        assert.notEqual(seenSeeds[0], seenSeeds.at(-1));
        assert.notDeepEqual(visible, original);
        click("Help");
        const helpSearch = document.querySelector<HTMLInputElement>('[data-map-editor="editor-help"] input')!;
        assert.equal(cameraKey(helpSearch), false, "typing in help does not move the camera");
        helpSearch.value = "warp";
        helpSearch.dispatchEvent(new browser.Event("input"));
        const help = document.querySelector('[data-map-editor="editor-help"]')!;
        assert.match(help.textContent ?? "", /Connect places with travel links/);
        assert.doesNotMatch(help.textContent ?? "", /Check where players can walk/);
        helpSearch.dispatchEvent(new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        assert.equal(plugin.undo(), true);
        assert.deepEqual(visible, original);
        assert.equal(plugin.undo(), true);
        assert.equal(visible, undefined);
        assert.equal(plugin.redo(), true);
        assert.equal(plugin.exportModifiedRegionPacks()[0].regionId, id);
        click("Review changes");
        assert.match(document.querySelector('[data-map-editor="review-changes"]')?.textContent ?? "", /New map square.*Terrain draft/);
        click("Download map overrides as a ZIP");
        const deadline = Date.now() + 1500;
        while (!downloads.length && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 25));
        const path = `regions/${id}.pack`;
        assert.equal(downloads[0]?.name, "map-overrides.zip");
        const zip = await require("jszip").loadAsync(await downloads[0].contents.arrayBuffer());
        const exported = Object.keys(zip.files).find((file) => file.startsWith("map-edits/") && file.endsWith("/" + path))!;
        assert.deepEqual(await zip.file(exported).async("uint8array"), visible);
        const manifest = exported.slice(0, -path.length) + "manifest.json";
        assert.deepEqual(JSON.parse(await zip.file(manifest).async("string")), [{ path, exists: true }]);
        assert.equal(plugin.isNewMapSquare(id), true, "export leaves the editable draft and its undo history open");
        click("Save reviewed map edits");
        await settled();
        assert.deepEqual(saved[0], { paths: [path], additions: [path] });
        assert.equal(plugin.isNewMapSquare(id), false);
        assert.equal(plugin.undo(), false);
        click("Load the saved squares into the running world");
        assert.deepEqual(reloads, [[id]]);
        plugin.setConfig({ edits: [{ ...tile, kind: "height", locId: 90, shape: 0, rotation: 0 }] });
        click("Save reviewed map edits");
        await settled();
        assert.deepEqual(saved[1], { paths: [path], additions: [] });
        assert.notDeepEqual(visible, original, "a later edit is applied to the installed pack");
    } finally {
        worldMap.close();
        unmount();
        plugin.setConfig({ active: false });
        EditorMapFiles.open = open;
        EditorMapFiles.supported = supported;
        fileSaver.saveAs = saveAs;
        globalThis.fetch = originalFetch;
        connection.lastUrl = previousUrl;
        browser.close();
    }
});
