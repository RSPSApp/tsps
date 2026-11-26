import { regionIdOf } from "./EditorCoordinates";
import type { EditModeEdit, EditModeTile } from "./types";

type Changes = {
    tile: EditModeTile;
    ground: boolean;
    objects: number;
};

export type EditorChangeArea = {
    region: number;
    target: EditModeTile;
    ground: number;
    objects: number;
};

const keyOf = (x: number, y: number, plane: number) => `${x}:${y}:${plane}`;

/** Group adjacent edited tiles on the same floor and choose a real changed tile near their centre. */
export function editorChangeAreas(edits: readonly EditModeEdit[]): EditorChangeArea[] {
    const tiles = new Map<string, Changes>();
    for (const edit of edits) {
        if (edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander") continue;
        const { tileX, tileY, plane } = edit;
        const key = keyOf(tileX, tileY, plane);
        let entry = tiles.get(key);
        if (!entry) {
            entry = { tile: { tileX, tileY, plane }, ground: false, objects: 0 };
            tiles.set(key, entry);
        }
        if (edit.kind === "place" || edit.kind === "delete") entry.objects++;
        else entry.ground = true;
    }

    const areas: EditorChangeArea[] = [];
    for (const [key, start] of tiles) {
        tiles.delete(key);
        const { plane } = start.tile;
        const region = regionIdOf(start.tile.tileX, start.tile.tileY);
        const group = [start];
        let sumX = 0, sumY = 0, ground = 0, objects = 0;
        for (const entry of group) {
            const { tileX, tileY } = entry.tile;
            sumX += tileX;
            sumY += tileY;
            ground += Number(entry.ground);
            objects += entry.objects;
            for (let x = tileX - 1; x <= tileX + 1; x++) {
                for (let y = tileY - 1; y <= tileY + 1; y++) {
                    if (regionIdOf(x, y) !== region) continue;
                    const neighbour = keyOf(x, y, plane);
                    const next = tiles.get(neighbour);
                    if (!next) continue;
                    tiles.delete(neighbour);
                    group.push(next);
                }
            }
        }
        const centreX = sumX / group.length, centreY = sumY / group.length;
        const distance = ({ tileX, tileY }: EditModeTile) => (tileX - centreX) ** 2 + (tileY - centreY) ** 2;
        let target = start.tile;
        for (const { tile } of group) {
            if (distance(tile) < distance(target)) target = tile;
        }
        areas.push({ region, target, ground, objects });
    }
    return areas.sort((a, b) => a.region - b.region || a.target.plane - b.target.plane ||
        a.target.tileX - b.target.tileX || a.target.tileY - b.target.tileY);
}
