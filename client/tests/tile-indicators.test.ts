import { sceneTileHeight } from "../game/scene/SceneGeometry";
import { resolveHeightSamplePlaneForLocal } from "../game/scene/PlaneResolver";
import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientState } from "../game/ClientState";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { LegacyTileMarkersConfig, migrateTileMarkersConfig } from "../game/plugins/tilemarkers/migrateTileMarkers";
import { TileMarkersConfig } from "../game/plugins/tilemarkers/TileMarkersConfig";
import { TileMarkersPlugin } from "../game/plugins/tilemarkers/TileMarkersPlugin";

const config = inject(ConfigManager);
const GROUP = TileMarkersConfig.group;
const clear = () => {
    for (const group of [GROUP, LegacyTileMarkersConfig.group, "runelite"]) {
        for (const key of config.getConfigurationKeys(`${group}.`)) config.unsetConfiguration(group, key.slice(group.length + 1));
    }
    // The migration runs once per storage; forget it so each case starts fresh.
    (config as any).storage.removeItem("rl.config.migrated.tileindicators");
};

// --- RuneLite's TileIndicatorsConfig ------------------------------------------------------------
assert.equal(GROUP, "tileindicators");
const item = (key: string) => (TileMarkersConfig.items as any)[key];
const expect: [string, string, unknown, number][] = [
    ["highlightDestinationTile", "destinationTile", true, 1],
    ["highlightDestinationColor", "destinationTile", 0xff808080, 2],
    ["destinationTileFillColor", "destinationTile", 0x32000000, 3],
    ["destinationTileBorderWidth", "destinationTile", 2, 4],
    ["highlightHoveredTile", "hoveredTile", false, 1],
    ["highlightHoveredColor", "hoveredTile", 0, 2],
    ["hoveredTileFillColor", "hoveredTile", 0x32000000, 3],
    ["hoveredTileBorderWidth", "hoveredTile", 2, 4],
    ["highlightCurrentTile", "currentTile", false, 1],
    ["highlightCurrentColor", "currentTile", 0xff00ffff, 2],
    ["currentTileFillColor", "currentTile", 0x32000000, 3],
    ["currentTileBorderWidth", "currentTile", 2, 4],
];
for (const [key, section, def, position] of expect) {
    assert.deepEqual([item(key).section, item(key).default, item(key).position], [section, def, position], key);
    if (/Color$/.test(key)) assert.ok(item(key).alpha, `${key} takes alpha`);
}
assert.equal(item("highlightCurrentTile").name, "Highlight true tile");
assert.deepEqual(TileMarkersConfig.sections, {
    destinationTile: { name: "Destination tile", position: 0 },
    hoveredTile: { name: "Hovered tile", position: 1 },
    currentTile: { name: "Current tile", position: 2 },
});
assert.equal(TileMarkersPlugin.descriptor.name, "Tile Indicators");
assert.equal(TileMarkersPlugin.descriptor.enabledByDefault, false, "off by default, as in RuneLite");

// --- Migration of the old Tile Markers settings -------------------------------------------------
{
    clear();
    config.setConfigValue(LegacyTileMarkersConfig, "showDestinationTile", false);
    config.setConfigValue(LegacyTileMarkersConfig, "destinationTileColor", 0xa9a753);
    config.setConfiguration("runelite", "tilemarkersplugin", "true");
    migrateTileMarkersConfig(config);
    const c = config.getConfig(TileMarkersConfig);
    assert.equal(c.highlightDestinationTile(), false);
    assert.equal(c.highlightDestinationColor(), 0xffa9a753, "an old RGB colour moves as opaque");
    assert.equal(c.highlightCurrentTile(), false, "unsaved settings take RuneLite's defaults");
    assert.equal(config.getConfiguration("runelite", "tileindicatorsplugin"), "true", "a saved on/off moves");
    assert.equal(config.getConfiguration(LegacyTileMarkersConfig.group, "showDestinationTile"), undefined, "old keys removed");
    config.setConfigValue(TileMarkersConfig, "highlightDestinationTile", true);
    config.setConfigValue(LegacyTileMarkersConfig, "showDestinationTile", false);
    migrateTileMarkersConfig(config);
    assert.equal(c.highlightDestinationTile(), true, "once only");
}

// --- The overlay ----------------------------------------------------------------------------------
const player = { x: 3222, y: 3218, plane: 0 };
let cutscene = 0;
const client: any = {
    gameState: 30,
    controlledPlayerServerId: 1,
    varManager: { getVarbit: (id: number) => (id === 542 ? cutscene : 0) },
    playerEcs: { getIndexForServerId: () => 0, getX: () => player.x * 128 + 64, getY: () => player.y * 128 + 64, getLevel: () => player.plane },
    playerMovementSync: { getState: () => ({ tileX: player.x, tileY: player.y, ecsIndex: 0 }) },
    sceneGeometry: { tileHeight: () => 0, worldToScreen: (x: number, h: number, y: number) => [x * 10, y * 10 + h * 10] },
};

async function main(): Promise<void> {
    clear();
    ClientState.baseX = 3168;
    ClientState.baseY = 3168;
    ClientState.destinationWorldX = 0;
    ClientState.destinationWorldY = 0;
    ClientState.destinationX = 0;
    ClientState.destinationY = 0;
    const plugin = new TileMarkersPlugin(client, config);
    await plugin.start();
    const overlay = plugin.widgetOverlay;
    const shapes = () => JSON.parse(overlay.signature() || "[]");
    assert.equal(overlay.signature(), "", "defaults: destination on, but no destination yet");

    // Destination tile: grey border, black 50-alpha fill, width 2.
    ClientState.setDestination(3225 - 3168, 3220 - 3168);
    let s = shapes();
    assert.equal(s.length, 1);
    assert.deepEqual(s[0][0], [[32250, 32200], [32260, 32200], [32260, 32210], [32250, 32210]]);
    assert.deepEqual(s[0][1], [128 / 255, 128 / 255, 128 / 255, 1]);
    assert.deepEqual(s[0][2], [0, 0, 0, 50 / 255]);
    assert.equal(s[0][3], 2);

    // True tile: always (standing still too), cyan.
    config.setConfigValue(TileMarkersConfig, "highlightCurrentTile", true);
    s = shapes();
    assert.equal(s.length, 2);
    assert.deepEqual(s[1][0][0], [32220, 32180], "after the destination");
    assert.deepEqual(s[1][1], [0, 1, 1, 1]);

    // Hovered tile: RuneLite's default border is fully transparent; drawn first.
    config.setConfigValue(TileMarkersConfig, "highlightHoveredTile", true);
    assert.equal(shapes().length, 2, "no tile under the mouse");
    client.selectedSceneTile = { tileX: 3210, tileY: 3215, plane: 1 };
    assert.equal(plugin.hoveredTile()!.plane, player.plane, "picking reports a height plane; projection needs the player's server plane");
    s = shapes();
    assert.equal(s.length, 3);
    assert.deepEqual(s[0][0][0], [32100, 32150], "hovered first");
    assert.deepEqual(s[0][1], [0, 0, 0, 0], "RuneLite's (0,0,0,0) stays transparent");

    // Colours with alpha and widths.
    config.setConfigValue(TileMarkersConfig, "highlightHoveredColor", 0x80ff0000);
    config.setConfigValue(TileMarkersConfig, "hoveredTileFillColor", 0x00000000);
    config.setConfigValue(TileMarkersConfig, "hoveredTileBorderWidth", 3.5);
    s = shapes();
    assert.deepEqual([s[0][1], s[0][2], s[0][3]], [[1, 0, 0, 0x80 / 255], [0, 0, 0, 0], 3.5]);

    // A bridge edge has the bridge flag only under the polygon's center, not its north/east corners.
    const originalHeight = client.sceneGeometry.tileHeight;
    const map = { getTileRenderFlag: (level: number, x: number, y: number) =>
        level === 1 && x === player.x && y === player.y ? 2 : 0 } as any;
    const sampledPlanes: number[] = [];
    const host = {
        getHeightSamplePlaneForTile: (x: number, y: number, plane: number) =>
            resolveHeightSamplePlaneForLocal(map, plane, x, y),
        getTileHeightAtPlane: (x: number, y: number, plane: number) => {
            sampledPlanes.push(plane);
            return -plane * 2 + (x - player.x) / 8 + (y - player.y) / 4;
        },
    };
    client.sceneGeometry.tileHeight = (x: number, y: number, plane: number, anchorX?: number, anchorY?: number) =>
        sceneTileHeight(host, x, y, plane, anchorX, anchorY);
    config.setConfigValue(TileMarkersConfig, "highlightHoveredTile", false);
    config.setConfigValue(TileMarkersConfig, "highlightDestinationTile", false);
    sampledPlanes.length = 0;
    const bridged = overlay.build();
    assert.deepEqual(sampledPlanes, [1, 1, 1, 1], "all four corners use the center's bridge plane");
    assert.deepEqual(bridged[0].points, [[32220, 32160], [32230, 32161.25], [32230, 32173.75], [32220, 32172.5]],
        "sloping bridge corners retain their individual heights");
    config.setConfigValue(TileMarkersConfig, "highlightHoveredTile", true);
    client.selectedSceneTile = { tileX: player.x, tileY: player.y, plane: 1 };
    sampledPlanes.length = 0;
    const hoveredBridge = overlay.build();
    assert.deepEqual(sampledPlanes, Array(8).fill(1), "picked height plane 1 is not promoted a second time");
    assert.deepEqual(hoveredBridge[0].points, bridged[0].points, "hovered and true tiles share the bridge surface");
    for (const plane of [0, 1, 2, 3]) {
        assert.equal(sceneTileHeight(host, player.x + 0.5, player.y + 0.5, plane), -Math.min(3, plane + 1) * 2 + 0.1875);
        assert.equal(sceneTileHeight(host, player.x + 1.5, player.y + 0.5, plane), -plane * 2 + 0.3125,
            "ordinary terrain/water keeps its own plane");
    }
    client.sceneGeometry.tileHeight = originalHeight;

    // Cutscenes, logging out, turning off.
    cutscene = 1;
    assert.equal(overlay.signature(), "", "nothing in a cutscene");
    cutscene = 0;
    client.gameState = 10;
    assert.equal(overlay.signature(), "", "nothing logged out");
    client.gameState = 30;
    await plugin.stop();
    assert.equal(overlay.signature(), "", "nothing when off");

    // The renderers' own destination/true tiles stay off: no plugin answers tileMarkersConfig.
    const manager = new ClientPluginManager();
    manager.add(plugin as any);
    assert.equal(manager.tileMarkersConfig().enabled, false);
    assert.equal((plugin as any).tileMarkersConfig, undefined);

    clear();
    console.log("tile-indicators tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
