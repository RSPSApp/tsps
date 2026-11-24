import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { ClickMode } from "../game/InputManager";
import { getWorldClickBlockingWidgetAtPoint } from "../game/widgets/interaction/widgetClickProbe";
import { checkInteractions } from "../render/render/interact/check";
import { buildSimpleMenuEntries } from "../render/render/interact/menu";
import { isMouseInUIRegion } from "../render/render/interact/menu2";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { MenuState } from "../ui/menu/MenuState";

// The resizable side panel and its tab stones take a left click; the world around them takes it
// as the hover menu says ("Walk here"). Which is which comes from the panel's own widgets: the
// modern layout's panel and stone rows block clicks through the cache's no-click-through flag,
// the classic layout's background, borders and stone rows through their onLoad script.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();
const cache = vm.context.widgetManager;

const WIDTH = 998;
const HEIGHT = 768;
const uid = (group: number, child: number) => (group << 16) | child;

type Placement = [child: number, x: number, y: number, width: number, height: number];

/** The layout's panel widgets from the cache, after their onLoad, at their place on a 998x768 screen. */
function panelWidgets(group: number, placements: Placement[]): any[] {
    cache.getGroup(group);
    return placements.map(([child, x, y, width, height]) => {
        const cached = cache.getWidgetByUid(uid(group, child));
        assert.ok(cached, `${group}:${child} is in the cache`);
        if (Array.isArray(cached.onLoad)) {
            vm.runScriptEvent(createScriptEvent({ args: cached.onLoad, widget: cached }), 200000);
        }
        assert.equal(cached.noClickThrough, true, `${group}:${child} takes the clicks on it`);
        return { ...cached, x, y, width, height, hidden: false, isHidden: false };
    });
}

function managerFor(group: number, placements: Placement[]): any {
    const root = { uid: uid(group, 0) | 0xffff, type: 0, x: 0, y: 0, width: WIDTH, height: HEIGHT, hidden: false };
    const children = panelWidgets(group, placements);
    return {
        rootInterface: group,
        interfaceParents: new Map(),
        getInputRoots: () => [root],
        getAllGroupRoots: () => [],
        getStaticChildrenByParentUid: (parent: number) => (parent === root.uid ? children : []),
        getWidgetByUid: (id: number) => (id === root.uid ? root : children.find((w) => w.uid === id)),
        getWidgetFlags: (w: any) => w?.flags ?? 0,
    };
}

const layouts = {
    // Classic (161): background, both side borders, and the two stone-row backgrounds.
    classic: managerFor(161, [
        [38, 777, 460, 200, 281], [39, 759, 470, 26, 261], [40, 969, 470, 26, 261],
        [41, 757, 731, 241, 37], [57, 757, 433, 241, 37],
    ]),
    // Modern (164): the panel and the two halves of the stone row under it.
    modern: managerFor(164, [[96, 794, 457, 204, 275], [94, 767, 732, 231, 36], [95, 569, 732, 231, 36]]),
};

function leftClick(manager: any, x: number, y: number): string[] {
    const tileX = 3222, tileY = 3221;
    const input: any = {
        clickMode3: ClickMode.LEFT, saveClickX: x, saveClickY: y,
        get leftClickX() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickX : -1; },
        get leftClickY() { return this.clickMode3 === ClickMode.LEFT ? this.saveClickY : -1; },
        getInteractionMouseX: () => x, getInteractionMouseY: () => y,
        dragX: -1, dragY: -1, pickX: -1, pickY: -1,
    };
    const ran: string[] = [];
    const client: any = {
        inputManager: input,
        camera: { viewMatrix: new Float32Array(16), projectionMatrix: new Float32Array(16), containsScreenPoint: () => true },
        widgetManager: manager,
        getWidgetInteractionState: () => ({ isPointerOverMinimapClickTarget: () => false }),
        menuOpenedFrame: -100, menuOpen: false, tooltips: true,
        isPointOverWidget: (px: number, py: number) => getWorldClickBlockingWidgetAtPoint(manager, null, px, py) !== null,
        hasCloseOnOutsideClickModal: () => false,
        clientPlugins: { shouldKeepWorldMenuOpen: () => false }, closeMenu() {},
        hoveredTile: { tileX, tileY, plane: 0 }, varManager: vm.context.varManager,
        controlledPlayerServerId: 1, menuState: new MenuState(), settings: { leftClickOpensMenu: false },
        menuActiveSimpleEntries: [],
        npcEcs: { isActive: () => false, isLinked: () => false, queryByTile: () => [] },
        playerEcs: { getAllActiveIndices: () => [], getServerIdForIndex: () => -1, getName: () => "",
            getLevel: () => 0, getCombatLevel: () => 3, getTeam: () => 0,
            getIndexForServerId: () => -1, getX: () => 0, getY: () => 0 },
    };
    const canvas: any = { width: WIDTH, height: HEIGHT };
    const host: any = {
        osrsClient: client, stats: { frameCount: 100 }, app: { width: WIDTH, height: HEIGHT, gl: { canvas } }, canvas,
        cachedMenuEntries: [], cachedClientMenuEntries: [], cachedLocIds: new Set(), cachedObjIds: new Set(),
        cachedNpcIds: new Set(), cachedPlayerIds: new Set(), boundToCssEvent: () => ({}),
        computeTileAt: () => ({ tileX, tileY, plane: 0 }),
        isMouseInUIRegion: (mx: number, my: number) => isMouseInUIRegion(host, mx, my),
        sampleHeightAtExactPlane: () => 0, worldToScreen: () => undefined,
        screenToRay: () => ({}), getPlayerRawPlane: () => 0,
        updateInteractHighlightHoverTarget() {}, clearInteractHighlightHoverTarget() {},
        performWorldEntryAction() {},
        onInteractHighlightEntryInvoked: (entry: any) => ran.push(entry.option),
        toGLClickXY: () => ({ sx: x, sy: y }), spawnClickCross() {},
        sceneRaycaster: { raycast: () => [] },
        buildSimpleMenuEntries: (entries: any, options: any) => buildSimpleMenuEntries(host, entries, options),
    };
    checkInteractions(host);
    return ran;
}

const cases: Array<[layout: keyof typeof layouts, name: string, x: number, y: number, walks: boolean]> = [
    ["classic", "above the top stone row", 896, 426, true],
    ["classic", "left of the bottom stone row", 740, 750, true],
    ["classic", "the top stone row", 896, 440, false],
    ["classic", "the left border", 765, 600, false],
    ["classic", "the panel's background", 880, 600, false],
    ["classic", "the bottom stone row", 990, 760, false],
    ["modern", "left of the panel", 780, 600, true],
    ["modern", "above the panel", 896, 450, true],
    ["modern", "left of the stone row", 560, 750, true],
    ["modern", "the panel's background", 896, 600, false],
    ["modern", "the panel's left edge", 794, 600, false],
    ["modern", "the stone row", 600, 750, false],
];

const previous = { baseX: ClientState.baseX, baseY: ClientState.baseY };
Object.assign(ClientState, { baseX: 3200, baseY: 3200 });
try {
    for (const [layout, name, x, y, walks] of cases) {
        assert.deepEqual(leftClick(layouts[layout], x, y), walks ? ["Walk here"] : [],
            `${layout}, ${name} (${x},${y}): ${walks ? "a left click walks" : "the panel takes the click"}`);
    }
} finally {
    Object.assign(ClientState, previous);
}

console.log("resizable side panel left click: ok,", cases.length, "points");
