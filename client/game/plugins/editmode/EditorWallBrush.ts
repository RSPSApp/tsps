import { diagonalWallFace, diagonalWallJoin } from "../../../../server/plugins/agent/mcp/DiagonalWall.AgentMcp.js";
import { WORLD_COORD_MAX } from "./EditorCoordinates";
import type { EditModeEdit, EditModeTile } from "./types";

export interface WallBrush {
    wall: number;
    diagonal: number | null;
    diagonalJoin: number | null;
    gate: number | null;
    variants: readonly number[];
    mode: "straight" | "diagonal";
    opening: "none" | "gap" | "gate";
    flatten: boolean;
}

export const DEFAULT_WALL_BRUSH: WallBrush = {
    wall: 1902,
    diagonal: 1902,
    diagonalJoin: 1902,
    gate: null,
    variants: [],
    mode: "straight",
    opening: "none",
    flatten: true,
};

export function planWallRun(start: EditModeTile, end: EditModeTile, brush: WallBrush, max: number, rotation?: number): EditModeEdit[] {
    if (start.plane !== end.plane) return [];
    const dx = end.tileX - start.tileX;
    const dy = end.tileY - start.tileY;
    const diagonal = brush.mode === "diagonal" && brush.diagonal !== null;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const sx = Math.sign(dx) || 1;
    const sy = Math.sign(dy) || 1;
    const length = Math.min(max, 1 + (diagonal ? Math.round((Math.abs(dx) + Math.abs(dy)) / 2) : horizontal ? Math.abs(dx) : Math.abs(dy)));
    const steps = Array.from({ length }, (_, offset) => ({
        tileX: diagonal ? start.tileX + sx * offset : horizontal ? Math.min(start.tileX, end.tileX) + offset : start.tileX,
        tileY: diagonal ? start.tileY + sy * offset : horizontal ? start.tileY : Math.min(start.tileY, end.tileY) + offset,
        plane: start.plane,
    })).filter(({ tileX, tileY }) => inWorld(tileX, tileY));
    if (brush.opening !== "none" && steps.length < 3) return [];
    const facing = diagonal ? diagonalWallFace(sx, sy, Boolean((rotation ?? 0) & 2)) : rotation ?? (horizontal ? 1 : 0);
    const middle = Math.floor(steps.length / 2);
    const walls = steps.flatMap((tile, offset): EditModeEdit[] => {
        if (offset === middle && brush.opening !== "none") {
            if (diagonal || brush.opening === "gap" || brush.gate === null) return [];
            return [{ ...tile, kind: "place", locId: brush.gate, shape: 0, rotation: facing }];
        }
        const choices = brush.variants;
        const locId = diagonal ? brush.diagonal! : choices.length > 0 && offset % 4 === 2
            ? choices[Math.floor(offset / 4) % choices.length] : brush.wall;
        return [{ ...tile, kind: "place", locId, shape: diagonal ? 9 : 0, rotation: facing }];
    });
    const joinId = brush.diagonalJoin;
    if (!diagonal || joinId === null) return walls;
    const joins: EditModeEdit[] = [];
    for (let i = 1; i < walls.length; i++) {
        const previous = walls[i - 1];
        const next = walls[i];
        // An opening leaves no seam to fill on either side of its missing tile.
        if (next.tileX - previous.tileX !== sx || next.tileY - previous.tileY !== sy) continue;
        const joint = diagonalWallJoin(Math.max(previous.tileX, next.tileX), Math.max(previous.tileY, next.tileY), facing);
        if (inWorld(joint.x, joint.y)) {
            joins.push({ tileX: joint.x, tileY: joint.y, plane: start.plane, kind: "place",
                locId: joinId, shape: joint.type, rotation: joint.face });
        }
    }
    return [...walls, ...joins];
}

function inWorld(x: number, y: number): boolean {
    return x >= 0 && x <= WORLD_COORD_MAX && y >= 0 && y <= WORLD_COORD_MAX;
}
