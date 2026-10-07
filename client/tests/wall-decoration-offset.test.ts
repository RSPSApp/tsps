import assert from "node:assert/strict";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import {
    embeddedWallDecorationShift,
    wallDecorationNudge,
    wallDecorationOffset,
} from "../rs/scene/WallDecorationOffset";

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        1,
        LocModelType.WALL_DIAGONAL,
        3,
        16,
    ),
    { x: 8, y: 8 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        3,
        LocModelType.WALL_DIAGONAL,
        1,
        16,
    ),
    { x: -8, y: -8 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_OUTSIDE,
        1,
        LocModelType.WALL_DIAGONAL,
        3,
        24,
    ),
    { x: 12, y: 12 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE,
        1,
        LocModelType.WALL_DIAGONAL,
        1,
        16,
    ),
    { x: 0, y: 0 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_INSIDE,
        0,
        LocModelType.WALL,
        0,
        16,
    ),
    { x: 16, y: 0 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_INSIDE,
        1,
        LocModelType.WALL_CORNER,
        0,
        16,
    ),
    { x: 0, y: -16 },
);

assert.deepEqual(
    embeddedWallDecorationShift(
        LocModelType.WALL_DECORATION_INSIDE,
        2,
        LocModelType.WALL_CORNER,
        0,
        16,
    ),
    { x: 0, y: 0 },
);

assert.deepEqual(
    wallDecorationOffset(LocModelType.WALL_DECORATION_OUTSIDE, 2, 16),
    { x: -16, y: 0 },
);

assert.deepEqual(wallDecorationNudge(LocModelType.WALL_DECORATION_INSIDE, 0), {
    x: 1,
    y: 0,
});
assert.deepEqual(wallDecorationNudge(LocModelType.WALL_DECORATION_OUTSIDE, 1), {
    x: 0,
    y: -1,
});
assert.deepEqual(
    wallDecorationNudge(LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE, 3),
    { x: 0, y: 0 },
);

console.log("wall-decoration host offset and nudge checks passed");
