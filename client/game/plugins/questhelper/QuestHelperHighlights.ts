import type { TileHighlightManager } from "../../highlights/TileHighlightManager";
import type { HelperTarget, ReadonlyClientSnapshot, WorldTile } from "./QuestHelperProtocol";
/** Each provider exclusively owns one slot; existing user and server marker slots survive. */
export class OwnedTileHighlights {
    constructor(private readonly manager: TileHighlightManager, private readonly slot: number) { }
    clear(): void { this.manager.clear(this.slot); }
    replace(points: readonly WorldTile[], colourRgb: number): void {
        this.clear();
        this.manager.configure(this.slot, colourRgb, 2, 25, 0);
        for (const point of points)
            if (validTile(point))
                this.manager.set((point.plane << 28) | (point.x << 14) | point.y, this.slot, 0);
    }
}
const validTile = (p: WorldTile): boolean => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.plane) && p.x >= 0 && p.x <= 16383 && p.y >= 0 && p.y <= 16383 && p.plane >= 0 && p.plane <= 3;
export function resolveTargetTiles(targets: readonly HelperTarget[], snapshot: ReadonlyClientSnapshot, plane: number): WorldTile[] {
    const points = new Map<string, WorldTile>();
    const add = (p: WorldTile) => { if (p.plane === plane && validTile(p))
        points.set(`${p.plane}:${p.x}:${p.y}`, { x: p.x, y: p.y, plane: p.plane }); };
    for (const target of targets) {
        const matches = (id: number) => target.id === id || !!target.ids?.includes(id);
        if (target.kind === "tile" && target.x !== undefined && target.y !== undefined && target.plane !== undefined)
            add(target as WorldTile);
        if (target.kind === "npc")
            for (const npc of snapshot.npcs)
                if (matches(npc.transformedId ?? npc.id))
                    add(npc);
        if (target.kind === "object")
            for (const object of snapshot.objects)
                if (matches(object.id) && (target.x === undefined || object.x === target.x) && (target.y === undefined || object.y === target.y) && (target.plane === undefined || object.plane === target.plane))
                    add(object);
        if (target.kind === "item")
            for (const item of snapshot.groundItems)
                if (matches(item.id))
                    add(item);
    }
    return [...points.values()];
}
