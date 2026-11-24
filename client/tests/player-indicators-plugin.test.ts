import { strict as assert } from "node:assert";
import { TRADEMAIN } from "@runelite/api/gameval/InterfaceID";
import { INSIDE_WILDERNESS } from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { PlayerIndicatorsConfig } from "../game/plugins/playerindicators/PlayerIndicatorsConfig";
import { PlayerIndicatorsPlugin, decorateTarget } from "../game/plugins/playerindicators/PlayerIndicatorsPlugin";
import { MenuTargetType } from "../rs/MenuEntry";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";

const OWN = 0x00b8d4, FRIEND = 0x00c853, FRIENDS_CHAT = 0xaa00ff, TEAM = 0x136ef7, CLAN = 0x240fab, OTHERS = 0xff0000;

// Player store index -> [server id, name, tile x, tile y, level, team, world view].
type Row = { sid: number; name: string; x: number; y: number; level: number; team: number; wv: number };
const rows = new Map<number, Row>();
const add = (index: number, name: string, x: number, y: number, extra: Partial<Row> = {}) =>
    rows.set(index, { sid: index + 100, name, x, y, level: 0, team: 0, wv: -1, ...extra });
add(0, "Me", 3200, 3200);
add(1, "Pal", 3201, 3200);
add(2, "Chatter", 3202, 3200);
add(3, "Teammate", 3203, 3200, { team: 5 });
add(4, "Clanmate", 3204, 3200);
add(5, "Stranger", 3205, 3200);
add(6, "Upstairs", 3206, 3200, { level: 1 });
add(7, "Sailor", 3207, 3200, { wv: 2 });
add(8, "Both", 3208, 3200);
const varbits = new Map<number, number>();

const playerEcs = {
    getIndexForServerId: (sid: number) => [...rows].find(([, r]) => r.sid === sid)?.[0],
    getAllActiveIndices: () => rows.keys(),
    getName: (i: number) => rows.get(i)?.name,
    findIndexByName: (name: string) => [...rows].find(([, r]) => r.name.toLowerCase() === name.toLowerCase())?.[0],
    getX: (i: number) => rows.get(i)!.x * 128 + 64,
    getY: (i: number) => rows.get(i)!.y * 128 + 64,
    getLevel: (i: number) => rows.get(i)!.level,
    getTeam: (i: number) => rows.get(i)!.team,
    getWorldViewId: (i: number) => rows.get(i)!.wv,
    getIsHidden: () => false,
    getDefaultHeightTiles: () => 1.5,
};
const client: any = {
    gameState: 30,
    controlledPlayerServerId: 100,
    playerEcs,
    varManager: { getVarbit: (id: number) => varbits.get(id) ?? 0 },
    cs2Vm: {
        context: {
            friendList: [{ name: "Pal" }, { name: "Both" }],
            clanMembers: [{ name: "Chatter" }, { name: "Both" }],
            clanChannel: { userNames: ["Clanmate", "Both"] },
        },
    },
    sceneGeometry: {
        tileHeight: () => 0,
        worldToScreen: (x: number, h: number, y: number) => [x * 10, y * 10 + h * 10],
    },
    minimapGeometry: { drawnAt: -1e9, plane: 0, scale: 1, worldToMinimap: (x: number, y: number) => [x, -y] },
};
type Frame = [[number[], number[][]][], [string, number, number, number][]];
const frame = (plugin: PlayerIndicatorsPlugin): Frame => {
    const sig = plugin.widgetOverlay.signature();
    return sig === "" ? [[], []] : JSON.parse(sig);
};

async function main(): Promise<void> {
    const config = inject(ConfigManager);
    const set = (key: string, value: unknown) => config.setConfigValue(PlayerIndicatorsConfig, key as any, value);
    const plugin = new PlayerIndicatorsPlugin(client);
    await plugin.start();

    // RuneLite's defaults: friends, friends chat, team and clan on; own player and others off.
    const colors = () => [...rows.keys()].map((i) => plugin.colorFor(i));
    assert.deepEqual(colors(), [undefined, FRIEND, FRIENDS_CHAT, undefined, CLAN, undefined, undefined, undefined, FRIEND],
        "the teammate's team isn't the local player's");
    rows.get(0)!.team = 5;
    assert.equal(plugin.colorFor(3), TEAM, "same team");
    set("highlightOwnPlayer", "ENABLED");
    set("highlightOthers", "ENABLED");
    assert.equal(plugin.colorFor(0), OWN);
    assert.equal(plugin.colorFor(5), OTHERS);
    // A friend who is also in the friends chat and clan takes the friend colour (first match).
    assert.equal(plugin.colorFor(8), FRIEND);
    set("highlightFriends", "DISABLED");
    assert.equal(plugin.colorFor(8), FRIENDS_CHAT);
    set("highlightFriendsChat", "DISABLED");
    assert.equal(plugin.colorFor(8), CLAN);
    set("highlightClanMembers", "DISABLED");
    assert.equal(plugin.colorFor(8), undefined, "others never covers friends chat or clan members");
    assert.equal(plugin.colorFor(1), OTHERS, "a friend with friends off falls through to others");
    for (const key of ["highlightFriends", "highlightFriendsChat", "highlightClanMembers"]) set(key, "ENABLED");

    // PvP only: on in the Wilderness, off outside it.
    set("highlightOthers", "PVP");
    assert.equal(plugin.colorFor(5), undefined);
    varbits.set(INSIDE_WILDERNESS, 1);
    assert.equal(plugin.colorFor(5), OTHERS);
    varbits.clear();

    // Overlay: names above heads by default, no tiles; other levels and boats skipped.
    set("highlightOthers", "ENABLED");
    let [shapes, texts] = frame(plugin);
    assert.equal(shapes.length, 0);
    assert.deepEqual(texts.map((t) => t[0]), ["Me", "Pal", "Chatter", "Teammate", "Clanmate", "Stranger", "Both"]);
    const pal = texts.find((t) => t[0] === "Pal")!;
    assert.deepEqual(pal.slice(1), [FRIEND, 32015, Math.round(32005 - (1.5 * 128 + 40) / 128 * 10)], "above the head");
    set("playerNamePosition", "MODEL_CENTER");
    assert.equal(frame(plugin)[1][1][3], Math.round(32005 - 0.75 * 10), "half the model's height");
    set("playerNamePosition", "MODEL_RIGHT");
    assert.equal(frame(plugin)[1][1][2], 32015 + 10, "ten pixels right of the model");
    set("playerNamePosition", "DISABLED");
    assert.equal(plugin.widgetOverlay.signature(), "");
    set("drawTiles", true);
    [shapes, texts] = frame(plugin);
    assert.equal(shapes.length, 7);
    assert.deepEqual(shapes[1], [[0, 200 / 255, 83 / 255, 1], [[32010, 32000], [32020, 32000], [32020, 32010], [32010, 32010]]],
        "the player's tile in the friend colour");
    assert.equal(texts.length, 0);
    set("drawTiles", false);
    set("drawMinimapNames", true);
    assert.equal(plugin.widgetOverlay.signature(), "", "no minimap names while the minimap isn't drawn");
    client.minimapGeometry.drawnAt = performance.now();
    texts = frame(plugin)[1];
    assert.deepEqual(texts.find((t) => t[0] === "Pal"), ["Pal", FRIEND, 3202, -3200]);
    set("playerNamePosition", "ABOVE_HEAD");

    // Menu entries take the player's colour, with or without a selected item or spell.
    const world = { surface: "world", menu: true } as const;
    const menu: SimpleMenuEntry[] = [
        { option: "Trade with", target: "<col=ffffff>Pal<col=00ff00>  (level-3)", targetType: MenuTargetType.PLAYER, playerServerId: 101 },
        { option: "Use", target: "<col=ff9040>Coins</col><col=ffffff> -> <col=ffffff>Pal<col=00ff00>  (level-3)", targetType: MenuTargetType.PLAYER, playerServerId: 101 },
        { option: "Trade with", target: "<col=ffffff>Nobody<col=00ff00>  (level-3)", targetType: MenuTargetType.PLAYER, playerServerId: 999 },
        { option: "Walk here", target: "" },
    ];
    let out = plugin.transformMenuEntries(menu, world);
    assert.equal(out[0].target, "<col=00c853>Pal<col=00ff00>  (level-3)");
    assert.equal(out[1].target, "<col=ff9040>Coins</col><col=ffffff> -> <col=00c853>Pal<col=00ff00>  (level-3)");
    assert.equal(out[2], menu[2], "unknown players are left alone");
    assert.equal(decorateTarget("Pal", 0xff0000), "<col=ff0000>Pal");
    set("colorPlayerMenu", false);
    assert.equal(plugin.transformMenuEntries(menu, world), menu);
    set("colorPlayerMenu", true);

    // The trade screen's title.
    const title = (text: string, groupId = TRADEMAIN) =>
        plugin.widgetDisplayText({ groupId, text, width: 100, height: 20, lineHeight: 12 })?.text;
    assert.equal(title("Trading with: Pal"), "Trading with: <col=00c853>Pal</col>");
    assert.equal(title("Trading with: Pal", 12), undefined, "only the trade screen");
    assert.equal(title("Trading with: Nobody"), undefined);

    // Logged out or stopped: nothing.
    client.gameState = 10;
    assert.equal(plugin.widgetOverlay.signature(), "");
    client.gameState = 30;
    await plugin.stop();
    assert.equal(plugin.widgetOverlay.signature(), "");
    assert.equal(plugin.transformMenuEntries(menu, world), menu);
    assert.equal(title("Trading with: Pal"), undefined);
}

main()
    .then(() => console.log("player indicators plugin tests passed"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
