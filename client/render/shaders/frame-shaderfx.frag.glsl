#version 300 es

// The Shader Effects plugin's WebGL pass: a GLSL port of render/webgpu/shaders/shaderfx.wgsl.ts.
// It reads the frame texture (display colour), works in linear light, and writes display colour.
// The uniforms are the plugin's ten vec4s (game/plugins/shaderfx/ShaderFxState.ts, slot by slot).
// The texture is read with textureLod so every effect can sit in non-uniform control flow.

precision highp float;

uniform highp sampler2D u_frame;

uniform vec4 u_fx0; // screen: width, height, 1/width, 1/height
uniform vec4 u_fx1; // time: seconds, aspect (w/h), 0, 0
uniform vec4 u_fx2; // taken: damage vignette, big-hit colour split, big-hit shake, shockwave progress (<0 off)
uniform vec4 u_fx3; // dealt: hit punch, low health, special flash, level-up strength
uniform vec4 u_fx4; // events: level-up ring progress (<0 off), poison, ranged focus, glitch
uniform vec4 u_fx5; // spell glow rgb, strength
uniform vec4 u_fx6; // damage colour rgb, shockwave strength
uniform vec4 u_fx7; // lookA: grain, scanlines, vignette, lens fringe
uniform vec4 u_fx8; // lookB: sharpen, tilt shift, pixel size (0 off), posterize levels (0 off)
uniform vec4 u_fx9; // grade: grade index, grade strength, 0, 0

out vec4 fragColor;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, vec3(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sceneAt(vec2 uv) {
    vec3 c = textureLod(u_frame, clamp(uv, vec2(0.0), vec2(1.0)), 0.0).rgb;
    return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 saturate3(vec3 c, float amount) {
    return mix(vec3(luma(c)), c, amount);
}

vec3 grade(vec3 c, int index) {
    float g = clamp(luma(c), 0.0, 1.0);
    if (index == 1) {
        return c * vec3(1.10, 1.0, 0.86);
    } else if (index == 2) {
        return c * vec3(0.88, 1.0, 1.14);
    } else if (index == 3) {
        float m = (luma(c) - 0.18) * 1.35 + 0.18;
        return mix(c, vec3(max(m, 0.0)), 0.92);
    } else if (index == 4) {
        return vec3(luma(c)) * vec3(1.25, 1.0, 0.76);
    } else if (index == 5) {
        vec3 t = mix(vec3(0.80, 1.0, 1.15), vec3(1.20, 1.0, 0.80), smoothstep(0.08, 0.85, g));
        return c * t;
    } else if (index == 6) {
        return (saturate3(c, 1.55) - 0.18) * 1.12 + 0.18;
    } else if (index == 7) {
        return saturate3(c, 0.8) * 0.9 + vec3(0.035, 0.025, 0.05);
    } else if (index == 8) {
        vec3 t = mix(vec3(1.25, 0.65, 1.15), vec3(0.70, 1.15, 1.25), smoothstep(0.05, 0.8, g));
        return saturate3(c, 1.2) * t;
    }
    return c;
}

void main() {
    float t = u_fx1.x;
    float aspect = u_fx1.y;
    vec2 invScreen = u_fx0.zw;
    vec2 frag = gl_FragCoord.xy;
    vec2 uv = frag * invScreen;

    // Pixelate: snap to the middle of a block.
    if (u_fx8.z > 0.5) {
        vec2 cell = u_fx8.z * invScreen;
        uv = (floor(uv / cell) + vec2(0.5)) * cell;
    }

    vec2 centre = vec2(0.5, 0.5);
    vec2 d0 = uv - centre;
    float r = length(vec2(d0.x * aspect, d0.y));

    // Warps: poison wobble, hit shake, punch zoom, shockwave ring, glitch tears.
    if (u_fx4.y > 0.0) {
        uv += u_fx4.y * 0.0035 * vec2(sin(uv.y * 38.0 + t * 3.1), cos(uv.x * 33.0 + t * 2.3));
    }
    if (u_fx2.z > 0.0) {
        uv += u_fx2.z * 0.011 * vec2(sin(t * 93.0), cos(t * 71.0));
    }
    if (u_fx3.x > 0.0) {
        uv = centre + (uv - centre) * (1.0 - u_fx3.x * 0.055);
    }
    if (u_fx2.w >= 0.0) {
        float p = u_fx2.w;
        float x = (r - p * 1.05) / 0.09;
        float ring = exp(-x * x) * (1.0 - p) * u_fx6.w;
        uv -= normalize(d0 + vec2(0.00001, 0.0)) * ring * 0.03;
    }
    if (u_fx4.w > 0.0) {
        float tick = floor(t * 22.0);
        float band = floor(uv.y * 26.0);
        float h = hash12(vec2(band, tick));
        if (h > 0.8) {
            uv.x += (h - 0.9) * 0.34 * u_fx4.w;
        }
    }

    vec2 d = uv - centre;

    // Base sample with the colour split: the hit's, plus the lens fringe growing to the edges.
    float split = u_fx2.y * 0.03 + u_fx7.w * 0.016 * r;
    vec2 ca = d * split;
    vec3 col = vec3(sceneAt(uv + ca).r, sceneAt(uv).g, sceneAt(uv - ca).b);

    // Radial blur towards the middle: ranged speed lines and the hit punch.
    float blurAmt = u_fx4.z * 0.07 * smoothstep(0.1, 0.8, r) + u_fx3.x * 0.05;
    if (blurAmt > 0.001) {
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) {
            acc += sceneAt(uv - d * blurAmt * float(i) / 6.0);
        }
        col = acc / 7.0;
    }

    // Tilt shift: blur grows away from a sharp band across the middle.
    if (u_fx8.y > 0.0) {
        float rad = u_fx8.y * smoothstep(0.12, 0.5, abs(uv.y - 0.5)) * 0.007;
        if (rad > 0.0002) {
            vec3 acc = vec3(0.0);
            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.7853982;
                acc += sceneAt(uv + vec2(cos(a) / aspect, sin(a)) * rad);
            }
            col = mix(col, acc / 8.0, min(1.0, u_fx8.y));
        }
    }

    // Sharpen: add back what a 1px box blur takes away.
    if (u_fx8.x > 0.0) {
        vec2 px = invScreen;
        vec3 blur = (sceneAt(uv + vec2(px.x, 0.0)) + sceneAt(uv - vec2(px.x, 0.0))
            + sceneAt(uv + vec2(0.0, px.y)) + sceneAt(uv - vec2(0.0, px.y))) * 0.25;
        col += (col - blur) * u_fx8.x * 0.8;
    }

    // Poison: a green cast, thicker at the edges.
    if (u_fx4.y > 0.0) {
        float edge = smoothstep(0.2, 0.9, r);
        col = mix(col, col * vec3(0.72, 1.12, 0.62), u_fx4.y * 0.45);
        col += vec3(0.02, 0.18, 0.02) * u_fx4.y * edge;
    }

    // Low health: the colour drains and a red edge beats like a pulse.
    if (u_fx3.y > 0.0) {
        float beat = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(t * 5.6), 3.0);
        float edge = smoothstep(0.18, 0.85, r);
        col = saturate3(col, 1.0 - u_fx3.y * 0.45);
        col += u_fx6.rgb * u_fx3.y * beat * edge * 0.9;
        col *= 1.0 - u_fx3.y * 0.22 * edge;
    }

    // Damage vignette.
    if (u_fx2.x > 0.0) {
        float edge = smoothstep(0.12, 0.8, r);
        col = mix(col, col * 0.45 + u_fx6.rgb * 0.9, u_fx2.x * edge * 0.7);
        col += u_fx6.rgb * u_fx2.x * 0.06;
    }

    // Special attack: a golden flash from the middle.
    if (u_fx3.z > 0.0) {
        vec3 gold = vec3(1.0, 0.74, 0.22);
        col += gold * u_fx3.z * (0.55 * exp(-r * r * 6.0) + 0.1 + 0.25 * smoothstep(0.3, 0.9, r));
    }

    // Spell glow: the spell's colour blooms from the middle and rims the screen.
    if (u_fx5.w > 0.0) {
        col += u_fx5.rgb * u_fx5.w * (0.45 * exp(-r * r * 4.0) + 0.3 * smoothstep(0.3, 0.95, r));
    }

    // Level-up: an expanding golden ring over a soft glow.
    if (u_fx4.x >= 0.0) {
        float p = u_fx4.x;
        float x = (r - p * 1.1) / 0.07;
        float ring = exp(-x * x);
        col += vec3(1.0, 0.86, 0.35) * u_fx3.w * (ring * 1.6 * (1.0 - p) + 0.18 * exp(-r * r * 3.0));
    }

    // Always-on: vignette, grade, scanlines, grain, posterize.
    if (u_fx7.z > 0.0) {
        col *= 1.0 - u_fx7.z * 0.62 * smoothstep(0.3, 1.0, r);
    }
    if (u_fx9.y > 0.0) {
        col = mix(col, grade(col, int(u_fx9.x + 0.5)), u_fx9.y);
    }
    if (u_fx8.w > 0.5) {
        float levels = u_fx8.w;
        vec3 display = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
        col = pow(floor(display * levels + 0.5) / levels, vec3(2.2));
    }
    if (u_fx7.y > 0.0 && int(frag.y) % 3 == 0) {
        col *= 1.0 - u_fx7.y * 0.38;
    }
    if (u_fx7.x > 0.0) {
        float n = hash12(frag + fract(t) * vec2(137.1, 91.7)) - 0.5;
        col += n * u_fx7.x * 0.1 * (0.35 + luma(col));
    }

    fragColor = vec4(pow(min(max(col, vec3(0.0)), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
}
