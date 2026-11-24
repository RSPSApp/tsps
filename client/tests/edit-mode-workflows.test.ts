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
        getLocActions: (id) => id === 50 || id === 51 ? [] : ["Inspect", "Climb"],
        getLocName: (id) => id === 51 ? "Cave exit" : "null",
        loadTravel: async (kind) => kind === "map-warps" ? [] : [
            { id: 42, op: 2, name: "Cellar ladder", from: [3200, 3200, 0], destinations: [{ label: "Cellar", to: [3210, 9600, 1] }] },
            { id: 43, op: 2, name: "Return ladder", from: [3210, 9600, 1], destinations: [{ label: "Surface", to: [3200, 3200, 0] }] },
        ],
        getTerrainHeight: ({ tileX }) => readHeight(tileX),
        getTerrainFlags: () => 0,
        getUnderlaySwatches: () => [{ id: 7, name: "Grass", colorRgb: 0x306820 }],
        refreshEditedRegions: (regions) => rebuilds.push([...regions]),
        getCameraTile: () => tile,
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
        loadMapPlans: async () => require("../../server/plugins/world/MapPlans").catalog(),
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
    const click = (label: string) => find<HTMLButtonElement>(`button[aria-label="${label}"]`).click();
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
        const goTo = find<HTMLInputElement>('input[aria-label="Go to coordinates or region"]');
        goTo.focus();
        escape(goTo);
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
        assert.ok(planPanel.querySelector('button[aria-label="Position this design on the map"]'));
        planWidth.value = "";
        planWidth.dispatchEvent(new browser.Event("input"));
        assert.equal(planPanel.querySelector('button[aria-label="Position this design on the map"]'), null,
            "editing a dimension clears the old preview immediately");
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
        escape(canvas);

        click("Select the whole 64 x 64 region");
        const initialSelection = plugin.getState().selection;
        assert.ok(find(`${panel("selection-details")} details`).textContent?.includes("Region edges"));
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

        click("World map");
        const worldMapPanel = find(panel("world-map"));
        const create = [...worldMapPanel.querySelectorAll("button")].find((button) => button.textContent === "New region");
        assert.ok(create);
        create.click();
        assert.equal(create.getAttribute("aria-pressed"), "true");
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

        plugin.setConfig({ ghostUi: true });
        const ghostBar = panel("ghost-top-bar");
        assert.equal(find(`${panel("top-bar")}`).style.display, "none", "Classic controls yield the top bar");
        assert.equal(find(`${panel("ghost-floor-controls")}`).style.display, "flex");
        find<HTMLButtonElement>(`${ghostBar} button[aria-label="Terrain"]`).click();
        assert.match(find(panel("ghost-navigation")).textContent!, /Sculpt heights/);
        assert.equal(plugin.getConfig().tool, "select", "browsing a workspace does not arm a tool");

        const pressKey = (target: HTMLElement, key: string, ctrlKey = false) =>
            target.dispatchEvent(new browser.KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }));
        pressKey(canvas, "k", true);
        const finder = find(panel("ghost-tool-finder"));
        assert.equal(finder.hidden, false);
        const toolQuery = find<HTMLInputElement>(`${panel("ghost-tool-finder")} input`);
        toolQuery.value = "raise hill";
        toolQuery.dispatchEvent(new browser.Event("input"));
        pressKey(toolQuery, "Enter");
        assert.equal(finder.hidden, true);
        assert.equal(plugin.getTerrainBrush().action, "raise");
        assert.equal(find(`${panel("ghost-navigation")} button[aria-label="Raise land"]`).getAttribute("aria-current"), "true");

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
        const baseGround = [...find(panel("terrain-brush")).querySelectorAll("select")]
            .find((control) => control.options[0]?.text === "Choose a material")!;
        assert.equal(baseGround.value, "");
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.deepEqual(plugin.getConfig().edits, [], "the default base ground brush cannot erase terrain");
        assert.match(document.body.textContent!, /Choose a base ground material before painting/);
        choose(baseGround, "7");
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.equal(plugin.getConfig().edits[0]?.locId, 7);
        plugin.undo();
        choose(baseGround, "0");
        mouse("mousedown", 0);
        mouse("mouseup", 0);
        assert.equal(plugin.getConfig().edits[0]?.locId, 0, "clearing base ground is an explicit choice");
        plugin.undo();
        escape(canvas);
        assert.equal(plugin.getConfig().tool, "select", "Escape stops the idle GhostUI brush");
        assert.equal(document.querySelector(panel("terrain-brush")), null);

        click("Block walking");
        mouse("mousedown", 0);
        assert.equal(plugin.getConfig().edits[0].kind, "flag");
        mouse("mousemove", 2);
        browser.dispatchEvent(new browser.Event("blur"));
        assert.equal(plugin.getConfig().edits.length, 3, "losing focus finishes the visible live gesture");
        pressKey(canvas, "]");
        assert.equal(plugin.getTerrainBrush().radius, 1, "the radius shortcut works on the canvas");
        assert.match(find(panel("terrain-brush")).textContent!, /Brush radius: 1 tile/);
        find<HTMLButtonElement>(`${ghostBar} button[aria-label="Review changes"]`).click();
        assert.match(find(panel("review-changes")).textContent!, /Region 12850.*3 edited ground points/);
        find<HTMLButtonElement>(`${ghostBar} button[aria-label="Undo"]`).click();
        assert.match(find(panel("review-changes")).textContent!, /No unsaved changes/);
        find<HTMLButtonElement>(`${ghostBar} button[aria-label="Redo"]`).click();
        assert.equal(plugin.getConfig().edits.length, 3);
        click("Jump to changes at 3201, 3200, 0");
        assert.deepEqual(cameraTarget, { ...tile, tileX: 3201 }, "review jumps to an actual edited tile, even off-centre");

        const workspace = (label: string) => find<HTMLButtonElement>(`${ghostBar} button[aria-label="${label}"]`).click();
        const task = (label: string) => find<HTMLButtonElement>(`${panel("ghost-navigation")} button[aria-label="${label}"]`).click();
        workspace("Terrain");
        task("Paint overlay");
        click("Choose an overlay and tile shape");
        const material = find(`${panel("terrain-brush")} ${panel("overlay-palette")}`);
        assert.equal(material.previousElementSibling?.getAttribute("aria-expanded"), "true", "material picker sits beneath its trigger");
        escape(find(`${panel("overlay-palette")} input`));
        assert.equal(document.querySelector(panel("overlay-palette")), null);
        assert.equal(plugin.getConfig().tool, "terrain");

        task("Draw path");
        assert.ok(document.querySelector(panel("terrain-line-tool")));
        workspace("Build & Place");
        task("Place objects");
        assert.equal(document.querySelector(panel("terrain-line-tool")), null, "switching to placement closes the path inspector");

        task("Select objects and NPCs");
        assert.equal(find(`${panel("ghost-navigation")} button[aria-label="Select objects and NPCs"]`).getAttribute("aria-current"), "true");
        selectedObject = { ...tile, kind: "loc", locId: 50, locName: "Decorative rock", shape: 22, rotation: 3 };
        plugin.applyAtPointer();
        const objectActions = find(panel("object-actions"));
        assert.equal(objectActions.style.visibility, "visible");
        assert.equal(objectActions.style.top, "248px", "actions sit below the projected object");
        assert.deepEqual([...objectActions.querySelectorAll("button")].map(({ textContent }) => textContent),
            ["Move", "Duplicate", "Rotate", "Delete"]);
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
        click("Duplicate selected object");
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
        click("Move selected object");
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
        workspace("Select");
        task("Ground and areas");
        plugin.applyAtPointer();
        assert.equal(find(panel("selection-details")).style.display, "block");
        task("Buildings");
        assert.equal(find(panel("selection-details")).style.display, "none", "ground inspector closes when switching to building selection");
        task("Objects and NPCs");
        selectedObject = { ...tile, kind: "loc", locId: 42, locName: "Cellar ladder" };
        plugin.applyAtPointer();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(find(`${ghostBar} button[aria-label="Travel & Warps"]`).getAttribute("aria-pressed"), "true");
        click("Action");
        assert.equal(find<HTMLSelectElement>(`${panel("travel-links")} select[aria-label="Source object option"]`).value, "2");
        click("Review");
        click("Move the camera to this arrival tile");
        assert.deepEqual(cameraTarget, { tileX: 3210, tileY: 9600, plane: 1 });
        assert.match(find(panel("ghost-navigation")).textContent!, /Return ladder/);
        click("Go to Return ladder at 3210, 9600, 1");
        assert.match(find(panel("travel-links")).textContent!, /Return ladder/);

        task("Pick source object");
        selectedObject = { ...tile, kind: "loc", locId: 50, locName: "null" };
        plugin.applyAtPointer();
        assert.match(find(panel("travel-links")).textContent!, /Scenery #50/);
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
        click("Go to Cave exit at 3205, 3200, 0");
        assert.match(find(panel("travel-links")).textContent!, /Climb up.*Two-way.*Climb down/);
        click("Return");
        click("Make this route one-way");
        click("Continue to review");
        click("Include this link in the next map save");
        assert.match(find(panel("travel-links")).textContent!, /Climb up.*One-way/);
        assert.equal(document.querySelector('button[aria-label="Go to Object 50 at 3200, 3200, 0"]'), null, "the paired entrance is removed");
        hovered = tile;

        const dock = panel("ghost-floor-controls");
        assert.equal(document.querySelector(`${ghostBar} button[aria-label="Navigate"]`), null);
        const mapButton = find<HTMLButtonElement>(`${dock} button[aria-label="Open world map"]`);
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
        find<HTMLButtonElement>(`${dock} button[aria-label="Reset camera angle"]`).click();
        assert.equal(cameraResets, 1);

        workspace("Terrain");
        task("Draw path");
        plugin.applyAtPointer();
        assert.deepEqual(plugin.getState().pathStart, tile);
        pressKey(canvas, "k", true);
        const navigationSearch = find<HTMLInputElement>(`${panel("ghost-tool-finder")} input`);
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
        assert.equal(find(`${ghostBar} button[aria-label="Terrain"]`).getAttribute("aria-pressed"), "true");
        const jump = find<HTMLInputElement>(`${dock} ${panel("jump-to-location")} input`);
        const jumpForm = jump.form!;
        jump.value = "invalid";
        jumpForm.dispatchEvent(new browser.Event("submit", { cancelable: true }));
        assert.equal(jump.getAttribute("aria-invalid"), "true");
        assert.deepEqual(plugin.getState().pathStart, tile);
        jump.value = "3202, 3203, 2";
        jumpForm.dispatchEvent(new browser.Event("submit", { cancelable: true }));
        assert.deepEqual(cameraTarget, { tileX: 3202, tileY: 3203, plane: 2 });
        assert.equal(find<HTMLSelectElement>(`${dock} select`).value, "2");
        assert.equal(plugin.getConfig().tool, "path");
        assert.equal(plugin.getState().pathStart, undefined, "jumping clears the old path endpoint");
        assert.equal(document.querySelector(panel("jump-to-location")), null);
        plugin.setConfig({ heightLevel: 0 });

        workspace("Maps");
        assert.ok(document.querySelector(`${panel("ghost-navigation")} button[aria-label="Refresh world data"]`));
        task("Create new map");
        const picker = find(panel("world-map"));
        const pickCanvas = find<HTMLCanvasElement>(`${panel("world-map")} canvas`);
        pressKey(pickCanvas, "Enter");
        const chooseTerrain = [...picker.querySelectorAll("button")].find(({ textContent }) => textContent === "Choose terrain")!;
        assert.ok(chooseTerrain.disabled, "pending edits make a square unavailable for generation");
        pressKey(pickCanvas, "Escape");
        workspace("Build & Place");
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

        plugin.setConfig({ ghostUi: false, heightLevel: 0 });
        assert.equal(plugin.getBrushTiming(), "live", "the shared brush preference survives layout switching");
        assert.equal(find(panel("top-bar")).style.display, "flex");
        assert.equal(find(dock).style.display, "none");
        assert.equal(find(ghostBar).hidden, true);
        assert.equal(plugin.getConfig().edits.length, 3, "switching layout keeps the pending world edits");

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
    const land = require("../../server/plugins/world/LandscapePlans");
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
    globalThis.fetch = async (input) => {
        const { pathname, searchParams } = new URL(String(input));
        const seed = Number(searchParams.get("seed"));
        if (pathname.endsWith("/occupied")) return Response.json([]);
        if (pathname.endsWith("/scene")) {
            assert.equal(searchParams.get("squares"), String(id));
            seenSeeds.push(seed);
            return Response.json({ width: 64, height: 64, regions: [id], occupied: [], sceneryCount: 0,
                preview: { columns: 1, rows: 1, pixels: "AAAA", colours: ["#000000"] },
                packs: [{ regionId: id, data: Buffer.from(createRegionPack(id, true, 7 + seenSeeds.length, false)).toString("base64") }] });
        }
        assert.equal(pathname, "/api/world/landscapes");
        return Response.json(land.catalog());
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
    plugin.setConfig({ enabled: true, active: true, ghostUi: true });
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
        click("Maps");
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
        const helpSearch = document.querySelector<HTMLInputElement>('[data-map-editor="ghost-help"] input')!;
        assert.equal(cameraKey(helpSearch), false, "typing in help does not move the camera");
        helpSearch.value = "warp";
        helpSearch.dispatchEvent(new browser.Event("input"));
        const help = document.querySelector('[data-map-editor="ghost-help"]')!;
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
