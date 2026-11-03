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
