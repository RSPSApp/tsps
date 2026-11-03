const float PRIORITY_LAYER_EPSILON = 0.015;
const float TOP_PRIORITY_EXTRA_BIAS = 0.01;

void applyPriorityDepthBias(inout vec4 viewPos, uint priority) {
    uint priorityBand = priority & 0x7u;
    if (priorityBand == 0u) {
        return;
    }

    float layer = float(priorityBand);
    if (priorityBand == 7u) {
        layer += TOP_PRIORITY_EXTRA_BIAS / PRIORITY_LAYER_EPSILON;
    }

    viewPos.z += layer * PRIORITY_LAYER_EPSILON;
}

// Where the line of sight to a view-space vertex `sunkTiles` below its floor (actorSunkTiles)
// crosses that floor's level: the same screen position, at the depth the floor has there.
// `worldToView` is rigid, so a world tile up is a unit view vector.
vec4 actorFloorViewPos(vec4 viewPos, float sunkTiles, mat4 worldToView, mat4 projection) {
    bool ortho = projection[3][3] > 0.5;
    vec3 up = (worldToView * vec4(0.0, -1.0, 0.0, 0.0)).xyz;
    vec3 towardEye = ortho ? vec3(0.0, 0.0, 1.0) : -viewPos.xyz;
    float rise = dot(towardEye, up);
    if (sunkTiles <= 0.0 || rise <= 0.0) {
        return viewPos;
    }
    float along = sunkTiles / rise;
    return vec4(viewPos.xyz + towardEye * (ortho ? along : min(along, 0.999)), viewPos.w);
}
