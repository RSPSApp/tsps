// Textures are uploaded with gamma 1.0. Native brightness applies their gamma once,
// then multiplies ordinary vertex lighting. Untextured faces sample white and their
// vertex HSL palette already carries gamma, so it passes through unchanged.
vec3 applyBrightness(vec3 texel, vec3 lit) {
    return pow(max(texel, vec3(0.0)), vec3(u_brightness)) * lit;
}
