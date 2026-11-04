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
    // Keep fractional terrain heights between vertices.
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

// Actors follow the native bilinear floor rather than the higher terrain diagonal.
float getActorHeightInterp(vec2 pos, uint plane) {
    vec2 tilePos = pos / float(tileSize);
    ivec2 tile = ivec2(floor(tilePos));
    vec2 offset = fract(tilePos);
    float row0 = mix(float(getTileHeight(tile.x, tile.y, plane)),
        float(getTileHeight(tile.x + 1, tile.y, plane)), offset.x);
    float row1 = mix(float(getTileHeight(tile.x, tile.y + 1, plane)),
        float(getTileHeight(tile.x + 1, tile.y + 1, plane)), offset.x);
    return mix(row0, row1, offset.y);
}

// The floor's y (local units, y down) under a local x/z, moved by the ground offset an actor
// takes, so it keeps the actor's ground clearance.
float actorFloorY(vec2 xz, uint plane, float groundOffset) {
    return -getHeightInterp(xz, plane) + groundOffset;
}

// OSRS paints an actor after its floor, so a death or emote that sinks part of the model into the
// ground still shows it; a depth-tested floor would hide it. For an actor vertex below the floor
// (`localPos` in local units after its tile height and ground offset), this is the view-space point
// where its line of sight comes up through the floor: the same screen position, at the depth the
// floor has there, so the floor no longer covers it and a wall in front still does. The crossing
// is the first one on the height map along the ray: marched in 8-unit steps (up to 8 tiles) to
// bracket it, then bisected. With no crossing in reach the vertex keeps its own depth.
// `worldToView` is rigid.
const float ACTOR_FLOOR_MARCH_STEP = 8.0;
const int ACTOR_FLOOR_MARCH_STEPS = 128;
const int ACTOR_FLOOR_BISECTIONS = 6;

vec4 actorFloorViewPos(vec4 viewPos, vec4 localPos, uint plane, float groundOffset, mat4 worldToView, mat4 projection) {
    if (localPos.y <= actorFloorY(localPos.xz, plane, groundOffset)) {
        return viewPos;
    }
    bool ortho = projection[3][3] > 0.5;
    vec3 towardEye = ortho ? vec3(0.0, 0.0, 1.0) : -viewPos.xyz;
    // Local units moved per unit of t along the ray; in perspective t = 1 is the eye.
    vec3 ray = transpose(mat3(worldToView)) * towardEye * 128.0;
    float stepT = ACTOR_FLOOR_MARCH_STEP / max(length(ray), 0.001);
    float maxT = ortho ? 1.0e6 : 0.999;
    float under = 0.0;
    float over = -1.0;
    for (int i = 1; i <= ACTOR_FLOOR_MARCH_STEPS; i++) {
        float t = min(float(i) * stepT, maxT);
        vec3 p = localPos.xyz + ray * t;
        if (p.y <= actorFloorY(p.xz, plane, groundOffset)) {
            over = t;
            break;
        }
        under = t;
        if (t >= maxT) {
            break;
        }
    }
    if (over < 0.0) {
        return viewPos;
    }
    for (int i = 0; i < ACTOR_FLOOR_BISECTIONS; i++) {
        float mid = 0.5 * (under + over);
        vec3 p = localPos.xyz + ray * mid;
        if (p.y <= actorFloorY(p.xz, plane, groundOffset)) {
            over = mid;
        } else {
            under = mid;
        }
    }
    return vec4(viewPos.xyz + towardEye * over, viewPos.w);
}
