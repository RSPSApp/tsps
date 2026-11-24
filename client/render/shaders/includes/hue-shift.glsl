// Relative RGB hue rotation, including texture pixels. Neutral colours stay neutral.
vec3 shiftVisualHue(vec3 rgb, float turns) {
    if (turns == 0.0) return rgb;
    float high = max(rgb.r, max(rgb.g, rgb.b));
    float low = min(rgb.r, min(rgb.g, rgb.b));
    float chroma = high - low;
    if (chroma < 0.000001) return rgb;
    float hue = high == rgb.r ? (rgb.g - rgb.b) / chroma : high == rgb.g ? (rgb.b - rgb.r) / chroma + 2.0 : (rgb.r - rgb.g) / chroma + 4.0;
    hue = mod(hue + turns * 6.0, 6.0);
    float x = chroma * (1.0 - abs(mod(hue, 2.0) - 1.0));
    vec3 shifted = hue < 1.0 ? vec3(chroma,x,0.0) : hue < 2.0 ? vec3(x,chroma,0.0) : hue < 3.0 ? vec3(0.0,chroma,x) : hue < 4.0 ? vec3(0.0,x,chroma) : hue < 5.0 ? vec3(x,0.0,chroma) : vec3(chroma,0.0,x);
    return shifted + low;
}
