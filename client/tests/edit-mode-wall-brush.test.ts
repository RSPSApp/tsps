import assert from "node:assert/strict";
import { DEFAULT_WALL_BRUSH, planWallRun } from "../game/plugins/editmode/EditorWallBrush";

const start = { tileX: 3200, tileY: 3200, plane: 0 };
const end = { ...start, tileX: 3206, tileY: 3202 };
const straight = planWallRun(start, end, DEFAULT_WALL_BRUSH, 512);
assert.equal(straight.length, 7);
assert.ok(straight.every((tile) => tile.tileY === start.tileY && tile.locId === 1902 && tile.rotation === 1));
const gate = planWallRun(start, end, {
    ...DEFAULT_WALL_BRUSH, wall: 1626, variants: [1624], gate: 1535, opening: "gate",
}, 512);
assert.equal(gate[2].locId, 1624);
assert.deepEqual(gate[3], { ...start, tileX: 3203, kind: "place", locId: 1535, shape: 0, rotation: 1 });

const descending = { ...start, tileX: 3205, tileY: 3195 };
const diagonal = planWallRun(start, descending, {
    ...DEFAULT_WALL_BRUSH, mode: "diagonal", diagonal: 24371, diagonalJoin: 24379, opening: "gap",
}, 512, 2);
const segments = diagonal.filter(({ shape }) => shape === 9);
assert.equal(segments.length, 5);
assert.ok(segments.every(({ tileX, tileY, rotation }) => tileX + tileY === 6400 && rotation === 3));
assert.ok(segments.every(({ tileX }) => tileX !== 3203));
assert.deepEqual(diagonal.filter(({ shape }) => shape === 1).map(({ tileX, tileY, rotation, locId }) =>
    [tileX, tileY, rotation, locId]), [[3201, 3200, 3, 24379], [3202, 3199, 3, 24379], [3205, 3196, 3, 24379]]);

for (const [dy, flip, face, x, y] of [
    [1, 0, 0, 3201, 3200], [-1, 0, 1, 3200, 3199],
    [1, 2, 2, 3200, 3201], [-1, 2, 3, 3201, 3200],
]) {
    const next = { ...start, tileX: 3201, tileY: start.tileY + dy };
    const brush = { ...DEFAULT_WALL_BRUSH, mode: "diagonal" as const };
    for (const [from, to] of [[start, next], [next, start]]) {
        const run = planWallRun(from, to, brush, 512, flip);
        assert.equal(run.filter(({ shape, rotation }) => shape === 9 && rotation === face).length, 2);
        assert.deepEqual(run.find(({ shape }) => shape === 1),
            { tileX: x, tileY: y, plane: 0, kind: "place", locId: 1902, shape: 1, rotation: face });
    }
}
