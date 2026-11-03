uniform int u_sceneBorderSize;
const int tileSize = 128;

int getTileHeight(int x, int z, uint plane) {
    return texelFetch(u_heightMap, ivec3(u_sceneBorderSize + x, u_sceneBorderSize + z, plane), 0).r * 8;
}

// Height interpolation that matches the terrain mesh surface.
//
// The terrain is triangulated per-tile along one of two diagonals depending
// on tile shape/rotation. Since that data isn't available in the shader we
// compute the height for BOTH possible diagonal splits and take the maximum.
// This guarantees objects sit at or above the rendered terrain surface
// regardless of the actual diagonal — a small upward bias on mismatched
// tiles is far less noticeable than clipping underground.
float getHeightInterp(vec2 pos, uint plane) {
    vec2 tilePos = pos / float(tileSize);
    ivec2 tile = ivec2(floor(tilePos));
    vec2 offset = fract(tilePos);
    float hSW = float(getTileHeight(tile.x, tile.y, plane));
    float hSE = float(getTileHeight(tile.x + 1, tile.y, plane));
    float hNW = float(getTileHeight(tile.x, tile.y + 1, plane));
    float hNE = float(getTileHeight(tile.x + 1, tile.y + 1, plane));

    // SE-NW diagonal (offset.x + offset.y = 1)
    // Match BridgeHeightSampler without rounding the actor's height to whole units.
    float h0;
    if (offset.x + offset.y <= 1.0) {
        h0 = hSW + (hSE - hSW) * offset.x + (hNW - hSW) * offset.y;
    } else {
        h0 = hNE + (hNW - hNE) * (1.0 - offset.x) + (hSE - hNE) * (1.0 - offset.y);
    }

    // SW-NE diagonal (offset.x = offset.y)
    float h1;
    if (offset.x <= offset.y) {
        h1 = hSW + (hNW - hSW) * offset.y + (hNE - hNW) * offset.x;
    } else {
        h1 = hSW + (hSE - hSW) * offset.x + (hNE - hSE) * offset.y;
    }

    return max(h0, h1);
}

// How far an actor vertex (local units, after its tile height and ground offset) is below the
// floor under it, in tiles; groundOffset is the ground offset the actor took. OSRS paints an actor
// after its floor, so a death or emote that sinks part of the model into the ground still shows
// it, and so do legs reaching over higher ground than the actor stands on; a depth-tested floor
// would hide them. Actor shaders keep such a vertex where it projects but take its depth from
// actorFloorViewPos, so the floor no longer covers it and walls in front still do.
float actorSunkTiles(vec4 localPos, uint plane, float groundOffset) {
    float floorY = -getHeightInterp(localPos.xz, plane) + groundOffset;
    return max(localPos.y - floorY, 0.0) / 128.0;
}
