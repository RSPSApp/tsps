// The browser designer's skin row offers 0-7 and purple (12) always, and the Halloween colours
// (8 green, 9 black, 10 white, 11 blue) only once the server's unlock varbits are set, as the
// cache's [proc,makeover_unlockedcolour] gates them.
import assert from "node:assert/strict";

import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { PlayerDesignController } from "../game/widgets/PlayerDesignController";

const HW07 = 4803, HW15 = 4804, HW17 = 6007;
const SKIN_LEFT = 62, SKIN_RIGHT = 63;

function designer(unlocked: number[], skin: number) {
    let preview = new PlayerAppearance(0, [0, 0, 0, 0, skin], [0, 1, 2, 3, 4, 5, 6]);
    const ecs: any = {
        getIndexForServerId: () => 0, getAppearance: () => preview,
        setAppearance: (_index: number, next: PlayerAppearance) => { preview = next; },
        ensureBaseForIndex() {}, setIsHidden() {}, setHeadIconPrayer() {}, setHeadIconPk() {}, setTeam() {},
    };
    const widgetManager: any = {
        getInterfaceParentContainerUid: () => 1, findWidget: () => undefined, findLoadedWidget: () => undefined,
    };
    const varManager: any = { setVarbit() {}, getVarbit: (id: number) => (unlocked.includes(id) ? 1 : 0) };
    const controller = new PlayerDesignController({
        getIdkTypeLoader: () => ({ getCount: () => 14, load: (id: number) => ({ bodyPartId: id }) }),
        getControlledPlayerServerId: () => 1, playerEcs: ecs, widgetManager, varManager,
    } as any);
    return (button: number, clicks: number) => Array.from({ length: clicks }, () => {
        assert.equal(controller.handleWidgetAction(button), true);
        return preview.colors[4];
    });
}

assert.deepEqual(designer([], 7)(SKIN_RIGHT, 3), [12, 0, 1], "no unlocks: 7 -> 12 -> 0");
assert.deepEqual(designer([], 0)(SKIN_LEFT, 3), [12, 7, 6], "no unlocks: 0 -> 12 -> 7");
assert.deepEqual(designer([HW15], 7)(SKIN_RIGHT, 4), [9, 10, 12, 0], "hw15_skincols: black and white, not green or blue");
assert.deepEqual(designer([HW15], 0)(SKIN_LEFT, 4), [12, 10, 9, 7]);
assert.deepEqual(designer([HW07, HW15, HW17], 7)(SKIN_RIGHT, 6), [8, 9, 10, 11, 12, 0], "every unlock");
assert.deepEqual(designer([], 9)(SKIN_RIGHT, 1), [12], "a saved locked colour steps to the next open one");
assert.deepEqual(designer([], 9)(SKIN_LEFT, 1), [7]);
assert.deepEqual(designer([], 13)(SKIN_RIGHT, 1), [0], "an unknown colour starts the row over");

console.log("player-design-skin-unlocks passed");
