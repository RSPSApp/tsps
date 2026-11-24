import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CacheSystem } from '../rs/cache/CacheSystem';
import { WorldMapState } from '../rs/map/WorldMapArea';
import { loadCache, loadCacheInfos, loadCacheList } from '../scripts/cache/load-util';
import { PluginMessage } from '@runelite/api/events/PluginMessage';
import { GameStateChanged } from '@runelite/api/events/GameStateChanged';
import { GameState } from '@runelite/api/GameState';
import { MonsterExaminePlugin } from '../game/plugins/monsterexamine/MonsterExaminePlugin';
import { createMinimapGeometry } from '../game/scene/minimapProjection';
import { ClientState } from '../game/ClientState';
import { flushPackets, setPacketSocket } from '../network/packet';
import { state } from '../network/serverConnection/state';
import { decodeClientPackets } from '../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol';

async function main() {
    const wire: Uint8Array[] = [];
    (globalThis as any).WebSocket = { OPEN: 1 };
    state.socket = { readyState: 1, send: (bytes: Uint8Array) => wire.push(bytes) } as any;
    setPacketSocket(state.socket);
    const geometry = (zoom = 1, yaw = 0) => createMinimapGeometry({
        plane: 0, scale: 1, worldX: 3200, worldY: 3200, centerX: 100, centerY: 100,
        contains: (x, y) => Math.hypot(x - 100, y - 100) <= 90,
        project: (x, y) => ({ x: 100 + (x * Math.cos(yaw) - y * Math.sin(yaw)) * zoom,
            y: 100 + (x * Math.sin(yaw) + y * Math.cos(yaw)) * zoom }),
    });
    const client: any = { gameState: 30, controlledPlayerServerId: 1, minimapGeometry: geometry(),
        playerMovementSync: { getState: () => ({ tileX: 3200, tileY: 3200, level: 0 }) } };
    const plugin = new MonsterExaminePlugin(client);
    const readWire = () => { flushPackets(); const messages = decodeClientPackets(Buffer.concat(wire.map(p => Buffer.from(p)))); wire.length = 0; return messages; };
    const beforeInstance = ClientState.inInstance;
    try {
        await plugin.start();
        assert.deepEqual(readWire().filter(message => message.type === 'plugin_message' && message.channel === 'bestiary'),
            [{ type: 'plugin_message', channel: 'bestiary', data: { type: 'client-state', enabled: true } }]);
        const points = [{ x: 3201, y: 3201, plane: 0 }, { x: 3203, y: 3202, plane: 0 },
            { x: 3500, y: 3200, plane: 0 }, { x: 3600, y: 3200, plane: 0 },
            { x: 3200, y: 3200, plane: 1 }, { x: 3201, y: 3201, plane: 0 }];
        const find = (revision: number, extra = {}) => new PluginMessage('bestiary', {
            type: 'find', revision, npcId: 224, name: 'Black dragon', points, expiresAt: Date.now() + 600000, ...extra,
        });
        plugin.onPluginMessage(find(1));
        assert.equal(plugin.pins.selection()!.points.length, 5, 'wire duplicates collapse');
        const lines: any[] = [], polygons: any[] = [];
        const context: any = { renderer: { drawPolyline: (...args: any[]) => lines.push(args),
            drawPolygon: (...args: any[]) => polygons.push(args) } };
        ClientState.inInstance = false;
        plugin.pins.signature();
        plugin.pins.draw(context);
        assert.equal(lines.filter(line => line[1] === 2).length, 3, 'two real nearby pins plus one direction per distant sector');
        assert.equal(lines.filter(line => line[1] === 4).length, 3, 'minimap markers retain dark outlines');
        assert.equal(polygons.length, 1, 'distant positions are distinct arrow triangles, not invisible pins');
        assert.ok(lines.flatMap(l => l[0]).every(([x, y]: number[]) => Math.hypot(x - 100, y - 100) < 90));
        const unrotated = client.minimapGeometry.projectMarker(3500, 3200);
        client.minimapGeometry = geometry(1, Math.PI / 2);
        const rotated = client.minimapGeometry.projectMarker(3500, 3200);
        assert.ok(unrotated.x > 170 && Math.abs(unrotated.y - 100) < 1);
        assert.ok(rotated.y > 170 && Math.abs(rotated.x - 100) < 1, 'edge directions follow camera rotation');
        assert.equal(geometry(2).projectMarker!(3215, 3200)?.edge, true, 'zoom-in places off-map points on the mask edge');
        assert.equal(geometry(0.25).projectMarker!(3260, 3200)?.edge, false, 'zoom-out uses the visible mask reach');
        client.minimapGeometry = { ...geometry(), projectMarker: () => undefined };
        assert.deepEqual(plugin.pins.draw(context), [], 'points rejected by the mask cannot draw through the legacy projection');
        client.minimapGeometry = geometry(); client.minimapGeometry.drawnAt -= 501;
        assert.deepEqual(plugin.pins.draw(context), [], 'hidden/stale minimaps do not keep stale pins');
        client.minimapGeometry = geometry(); ClientState.inInstance = true;
        assert.deepEqual(plugin.pins.draw(context), [], 'public coordinates are never plotted as instance coordinates');
        ClientState.inInstance = false;
        plugin.onPluginMessage(new PluginMessage('bestiary', { type: 'clear', revision: 2 }));
        plugin.onPluginMessage(find(1));
        assert.equal(plugin.pins.selection(), undefined, 'an old find response cannot resurrect cleared markers');
        plugin.onPluginMessage(find(3));
        const worldLines: any[] = [];
        plugin.drawWorldMap({ renderer: { drawPolyline: (...a: any[]) => worldLines.push(a) } as any,
            bounds: { x: 0, y: 0, w: 1000, h: 1000 }, pixelsPerTileX: 1, pixelsPerTileY: 1,
            worldToScreen: (x, y, plane) => plane === 0 ? { x: x - 3000, y: y - 3000 } : undefined });
        assert.equal(worldLines.filter(line => line[1] === 2).length, 4, 'all known locations in the world map area draw, including distant ones');
        assert.equal(worldLines.filter(line => line[1] === 4).length, 4, 'dark outlines keep gold pins visible over map icons');
        const actualNow = Date.now;
        try {
            Date.now = () => Math.floor(actualNow() / 1300) * 1300;
            const goldSignature = plugin.pins.signature(); worldLines.length = 0;
            plugin.drawWorldMap({ ...context, bounds: { x: 0, y: 0, w: 1000, h: 1000 },
                renderer: { drawPolyline: (...a: any[]) => worldLines.push(a) },
                worldToScreen: () => ({ x: 100, y: 100 }) });
            const gold = worldLines.find(line => line[1] === 2)[2];
            const goldTime = Date.now(); Date.now = () => goldTime + 650;
            assert.notEqual(plugin.pins.signature(), goldSignature, 'alternating colors invalidate even a stationary map');
            worldLines.length = 0;
            plugin.drawWorldMap({ ...context, bounds: { x: 0, y: 0, w: 1000, h: 1000 },
                renderer: { drawPolyline: (...a: any[]) => worldLines.push(a) },
                worldToScreen: () => ({ x: 100, y: 100 }) });
            assert.notDeepEqual(worldLines.find(line => line[1] === 2)[2], gold);
        } finally { Date.now = actualNow; }
        ClientState.inInstance = true;
        const mapOnlySignature = plugin.pins.signature();
        plugin.pins.clear();
        assert.notEqual(plugin.pins.signature(), mapOnlySignature, 'clearing invalidates world-map pins even with no minimap drawing');
        ClientState.inInstance = false;
        const directions = [...Array.from({ length: 8 }, (_, i) => i * Math.PI / 4), Math.PI - 0.001, -Math.PI + 0.001];
        plugin.onPluginMessage(find(4, { points: directions.map(a => ({ x: Math.round(3200 + Math.cos(a) * 400),
            y: Math.round(3200 + Math.sin(a) * 400), plane: 0 })) }));
        lines.length = 0; polygons.length = 0;
        plugin.pins.draw(context);
        assert.equal(polygons.length, 8, 'west at both sides of the angle wrap shares one of eight sectors');
        plugin.onPluginMessage(find(5, { expiresAt: Date.now() - 1 }));
        assert.equal(plugin.pins.selection(), undefined, 'expired selections disappear');
        plugin.onPluginMessage(find(6, { points: Array.from({ length: 257 }, () => points[0]) }));
        assert.equal(plugin.pins.selection(), undefined, 'oversized marker datasets cannot leave an older selection active');
        plugin.onPluginMessage(find(7));
        plugin.onGameStateChanged(new GameStateChanged(GameState.HOPPING));
        assert.equal(plugin.pins.selection(), undefined);
        plugin.onPluginMessage(find(8));
        await plugin.stop();
        assert.equal(plugin.pins.selection(), undefined);
        assert.deepEqual(plugin.widgetOverlays(), []);
        assert.ok(readWire().some((m: any) => m.type === 'plugin_message' && m.data.enabled === false));
        const info = loadCacheList(loadCacheInfos()).latest;
        const nativeMap = WorldMapState.load(CacheSystem.fromFiles(info, loadCache(info).files));
        const canonical = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../server/data/definitions/npc-spawns.json'), 'utf8'));
        const kbd = canonical.find((spawn: any) => spawn.id === 239);
        assert.ok(kbd, 'the canonical KBD home is available');
        client.worldMapState = nativeMap;
        let invalidations = 0;
        client.widgetManager = { interfaceParents: new Map(), getGroupRoot: () => ({}), invalidateWidgetRender: () => invalidations++ };
        await plugin.start(); readWire();
        plugin.onPluginMessage(find(10, { npcId: 239, points: [{ x: kbd.x, y: kbd.y, plane: kbd.level }] }));
        const originalArea = nativeMap.getCurrentMapAreaId();
        plugin.pins.signature();
        assert.equal(nativeMap.getCurrentMapAreaId(), originalArea, 'Find waits for the native map to be mounted');
        client.widgetManager.interfaceParents.set(1, { group: 595 });
        plugin.pins.signature();
        const area = nativeMap.mapAreaAtCoord(kbd.level, kbd.x, kbd.y)!;
        assert.ok(area && !area.isMain, 'the real KBD home belongs to a cache dungeon submap');
        assert.equal(nativeMap.getCurrentMapAreaId(), area.id);
        const display = area.position(kbd.level, kbd.x, kbd.y)!;
        assert.deepEqual([nativeMap.displayX, nativeMap.displayY], [display.x, display.y], 'Find pans to the mapped dungeon coordinate');
        assert.equal(invalidations, 1);
        nativeMap.displayX++;
        plugin.pins.signature();
        assert.equal(nativeMap.displayX, display.x + 1, 'subsequent map panning is not reset every frame');
        plugin.onPluginMessage(find(11, { points: [{ x: 3200, y: 3200, plane: 0 }] }));
        plugin.pins.signature();
        assert.equal(nativeMap.getCurrentMapAreaId(), nativeMap.mapAreaAtCoord(0, 3200, 3200)!.id, 'surface locations return to the overworld');
        const locations = [{ x: 3200, y: 3200, plane: 0 }, { x: kbd.x, y: kbd.y, plane: kbd.level }];
        plugin.onPluginMessage(find(12, { points: locations, focusIndex: 1 })); plugin.pins.signature();
        assert.equal(nativeMap.getCurrentMapAreaId(), area.id, 'Next can cross from the overworld to a dungeon');
        assert.deepEqual([nativeMap.displayX, nativeMap.displayY], [display.x, display.y]);
        assert.equal(plugin.pins.selection()!.index, 1);
        plugin.onPluginMessage(find(13, { points: locations, focusIndex: 0 })); plugin.pins.signature();
        assert.equal(nativeMap.getCurrentMapAreaId(), nativeMap.mapAreaAtCoord(0, 3200, 3200)!.id);
        await plugin.stop(); readWire();
        plugin.onPluginMessage(find(14));
        assert.equal(plugin.pins.selection(), undefined, 'a stopped client plugin ignores late find messages');
    } finally {
        ClientState.inInstance = beforeInstance;
        setPacketSocket(null); state.socket = null;
        await plugin.stop();
    }
    console.log('Bestiary native pins, direction arrows, map projection, wire lifecycle and plugin removal passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
