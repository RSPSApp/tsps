#version 300 es

// The Shader Effects plugin's WebGL pass: a GLSL port of render/webgpu/shaders/shaderfx.wgsl.ts.
// It reads the frame texture (display colour), works in linear light, and writes display colour.
// The uniforms are the plugin's fourteen vec4s (game/plugins/shaderfx/ShaderFxState.ts, slot by slot).
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
uniform vec4 u_fx10; // status: ice freeze, entangle thorns, teleport warp, ink outlines
uniform vec4 u_fx11; // prayer aura rgb, strength
uniform vec4 u_fx12; // loot flash rgb (scaled by its strength), sweep progress (<0 off)
uniform vec4 u_fx13; // player on screen (u, v from the top, half height as a share of the height), 0

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

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Three octaves of value noise, for the prayer smoke.
float fbm(vec2 p) {
    return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + vec2(7.1, 3.7)) + 0.15 * vnoise(p * 4.1 + vec2(13.7, 9.2));
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// A rough signed distance to a standing figure, for the prayer aura: feet at y = -1 and the top of
// the head at y = 1, x to the right, all in half heights. Negative inside.
float figure(vec2 q) {
    vec2 p = vec2(abs(q.x), q.y);
    float d = length(q - vec2(0.0, 0.8)) - 0.17;                      // head
    d = min(d, sdCapsule(p, vec2(0.0, 0.62), vec2(0.0, 0.0), 0.25));     // torso
    d = min(d, sdCapsule(p, vec2(0.11, -0.05), vec2(0.13, -0.92), 0.1));  // legs
    d = min(d, sdCapsule(p, vec2(0.31, 0.55), vec2(0.35, -0.12), 0.07));  // arms
    return d;
}

vec3 saturate3(vec3 c, float amount) {
    return mix(vec3(luma(c)), c, amount);
}

vec3 toLinear(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(2.2));
}

// A heat ramp for the thermal grade: d is display brightness, 0 to 1.
vec3 thermal(float d) {
    vec3 c = mix(vec3(0.0, 0.0, 0.18), vec3(0.5, 0.0, 0.6), smoothstep(0.0, 0.3, d));
    c = mix(c, vec3(0.95, 0.2, 0.1), smoothstep(0.25, 0.55, d));
    c = mix(c, vec3(1.0, 0.75, 0.1), smoothstep(0.5, 0.8, d));
    return mix(c, vec3(1.0, 1.0, 0.85), smoothstep(0.78, 1.0, d));
}

// The four Game Boy greens, darkest to lightest.
vec3 gameBoy(float d) {
    int i = int(floor(clamp(d, 0.0, 0.999) * 4.0));
    if (i == 0) return vec3(0.059, 0.220, 0.059);
    if (i == 1) return vec3(0.188, 0.384, 0.188);
    if (i == 2) return vec3(0.545, 0.675, 0.059);
    return vec3(0.608, 0.737, 0.059);
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
    } else if (index == 9) {
        vec3 t = mix(vec3(0.65, 0.75, 1.40), vec3(1.40, 0.80, 0.95), smoothstep(0.08, 0.7, g));
        return (saturate3(c, 1.3) * t - 0.16) * 1.15 + 0.16;
    } else if (index == 10) {
        return saturate3(c, 1.1) * vec3(1.22, 1.02, 0.72) + vec3(0.03, 0.012, 0.0);
    } else if (index == 11) {
        return (mix(vec3(luma(c)), c, 0.45) - 0.18) * 1.35 + 0.18;
    } else if (index == 12) {
        float l = clamp(luma(c) * 1.8, 0.0, 1.5);
        return vec3(0.004, 0.02, 0.006) + vec3(0.08, 1.0, 0.16) * pow(l, 0.8);
    } else if (index == 13) {
        return toLinear(thermal(pow(clamp(luma(c), 0.0, 1.0), 0.45)));
    } else if (index == 14) {
        return mix(vec3(luma(c)) * vec3(1.45, 0.22, 0.16), c * vec3(1.2, 0.5, 0.45), 0.1);
    } else if (index == 15) {
        return toLinear(gameBoy(pow(clamp(luma(c), 0.0, 1.0), 0.45)));
    } else if (index == 16) {
        vec3 t = mix(vec3(0.92, 1.0, 1.06), vec3(1.08, 1.0, 0.92), smoothstep(0.1, 0.7, g));
        return saturate3(c, 0.7) * 0.88 * t + vec3(0.04, 0.045, 0.05);
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

    // Warps: teleport swirl, poison wobble, hit shake, punch zoom, shockwave ring, glitch tears.
    if (u_fx10.z > 0.0) {
        // A swirl strongest in the middle that unwinds as it fades, with a pull in on the centre.
        float tp = u_fx10.z;
        float angle = tp * 1.4 * exp(-r * r * 2.5);
        float sn = sin(angle);
        float cs = cos(angle);
        vec2 p = vec2(d0.x * aspect, d0.y);
        vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
        uv = centre + vec2(q.x / aspect, q.y) * (1.0 - tp * 0.1);
    }
    if (u_fx4.y > 0.0) {
        uv += u_fx4.y * 0.0035 * vec2(sin(uv.y * 38.0 + t * 3.1), cos(uv.x * 33.0 + t * 2.3));
    }
    if (u_fx2.z > 0.0) {
        uv += u_fx2.z * 0.011 * vec2(sin(t * 93.0), cos(t * 71.0));
    }
    if (u_fx3.x > 0.0) {
        uv = centre + (uv - centre) * (1.0 - u_fx3.x * 0.055);
    }
    if (u_fx4.z > 0.0) {
        // Ranged release: a quick push in on the target.
        uv = centre + (uv - centre) * (1.0 - u_fx4.z * 0.045);
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
    float split = u_fx2.y * 0.03 + u_fx7.w * 0.016 * r + u_fx10.z * 0.05;
    vec2 ca = d * split;
    vec3 col = vec3(sceneAt(uv + ca).r, sceneAt(uv).g, sceneAt(uv - ca).b);

    // Radial blur towards the middle: ranged speed lines and the hit punch.
    float blurAmt = u_fx4.z * 0.16 * smoothstep(0.08, 0.7, r) + u_fx3.x * 0.05;
    if (blurAmt > 0.001) {
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) {
            acc += sceneAt(uv - d * blurAmt * float(i) / 6.0);
        }
        col = acc / 7.0;
    }

    // Ranged focus: bright speed streaks radiate from the middle, and the edges close in.
    if (u_fx4.z > 0.0) {
        float ang = atan(d0.y, d0.x * aspect);
        float id = floor((ang + 3.14159265) / 6.2831853 * 110.0);
        float h = hash12(vec2(id, floor(t * 16.0)));
        float streak = step(0.7, h) * smoothstep(0.16, 0.7, r);
        col += vec3(1.0, 0.96, 0.85) * streak * u_fx4.z * 0.5;
        col *= 1.0 - u_fx4.z * 0.4 * smoothstep(0.3, 0.95, r);
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

    // Ink outlines: dark lines where the brightness jumps, and shading cut into flat bands.
    if (u_fx10.w > 0.0) {
        vec2 px = invScreen * 1.15;
        float lx = pow(luma(sceneAt(uv + vec2(px.x, 0.0))), 0.45) - pow(luma(sceneAt(uv - vec2(px.x, 0.0))), 0.45);
        float ly = pow(luma(sceneAt(uv + vec2(0.0, px.y))), 0.45) - pow(luma(sceneAt(uv - vec2(0.0, px.y))), 0.45);
        float edge = smoothstep(0.025, 0.1, sqrt(lx * lx + ly * ly));
        float shade = max(luma(col), 0.0001);
        float banded = floor(pow(shade, 0.45) * 5.0 + 0.5) / 5.0;
        col = mix(col, col * (pow(max(banded, 0.02), 2.2) / shade), 0.55 * u_fx10.w);
        col *= 1.0 - edge * 0.96 * u_fx10.w;
    }

    // Ice freeze: the colour chills and frost grows in from the edges in jagged crystals.
    if (u_fx10.x > 0.0) {
        float f = min(u_fx10.x, 1.2);
        float ang = atan(d0.y, d0.x * aspect);
        float shard = abs(sin(ang * 23.0 + sin(ang * 7.0) * 1.5));
        float facet = 0.5 + 0.5 * sin(uv.x * 61.0 + sin(uv.y * 47.0) * 2.0);
        float twinkle = step(0.992, hash12(floor(frag / 4.0)));
        float reach = 1.02 - f * 0.46;
        float frost = smoothstep(reach, reach + 0.05, r + shard * 0.1 + facet * 0.03);
        vec3 chill = mix(col, saturate3(col, 0.5) * vec3(0.78, 0.96, 1.22), f * 0.6);
        vec3 ice = vec3(0.62, 0.84, 1.0) * (0.82 + 0.18 * facet) + vec3(twinkle * 0.5);
        col = mix(chill, ice, frost * 0.85 * min(f, 1.0));
    }

    // Entangle thorns: dark vines with spikes close in from the edges, and the colour goes mossy.
    if (u_fx10.y > 0.0) {
        float th = u_fx10.y;
        // Distance to the nearest screen edge in heights, and the spot along that edge.
        float ex = min(uv.x, 1.0 - uv.x) * aspect;
        float ey = min(uv.y, 1.0 - uv.y);
        float e = min(ex, ey);
        float along = ey < ex ? uv.x * aspect : uv.y;
        float spike = abs(sin(along * 34.0 + sin(along * 9.0) * 1.6));
        float depth = min(th, 1.2) * 0.07 + spike * 0.06 * min(th, 1.0);
        float mask = 1.0 - smoothstep(depth, depth + 0.01, e);
        vec3 thorn = vec3(0.012, 0.04, 0.008) + vec3(0.05, 0.03, 0.0) * (1.0 - spike);
        col = mix(col, col * vec3(0.86, 0.98, 0.78), min(th, 1.0) * 0.25);
        col *= 1.0 - min(th, 1.0) * 0.4 * (1.0 - smoothstep(0.0, depth * 2.6, e));
        col = mix(col, thorn, mask * min(1.0, th * 1.6));
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

    // Prayer aura: a glowing outline close around the player with wisps rising off it, in the prayer colour.
    if (u_fx11.w > 0.0) {
        float rad = max(u_fx13.z, 0.03);
        vec2 q = vec2((uv.x - u_fx13.x) * aspect, uv.y - (1.0 - u_fx13.y)) / rad; // x right, y up, feet at -1 and head at +1
        float wisps = fbm(vec2(q.x * 2.6, q.y * 2.0 - t * 1.5));               // climbs with time
        float d = figure(q) + (0.5 - wisps) * 0.28 * (0.5 + 0.5 * smoothstep(-0.5, 1.0, q.y));
        float outside = mix(0.25, 1.0, smoothstep(-0.12, 0.05, d));            // lighter over the body itself
        float glow = exp(-max(d, 0.0) * 5.5) * outside;
        float rim = exp(-abs(d) * 20.0) * 0.7;
        float pulse = 0.9 + 0.1 * sin(t * 2.4);
        vec3 tint = mix(u_fx11.rgb, vec3(1.0), 0.12);
        col += tint * u_fx11.w * (glow * 1.1 + rim) * pulse;
    }

    // Loot flash: a wide soft sweep of light with a thin hot core, and round glints with small star
    // flares that twinkle in its wake. All smooth falloffs, no hard edges.
    if (u_fx12.w >= 0.0) {
        float p = u_fx12.w;
        float along = uv.x + uv.y * 0.45;
        float head = -0.35 + p * 2.2;
        float x = (along - head) / 0.16;
        float body = exp(-x * x);
        float core = exp(-x * x * 9.0);
        float bloom = exp(-x * x * 0.25) * 0.12;
        float behind = head - along;
        float trail = smoothstep(-0.05, 0.12, behind) * (1.0 - smoothstep(0.3, 0.85, behind));
        // Glints on a loose grid, each with its own spot, phase and say in whether it shows.
        vec2 g = vec2(uv.x * aspect, uv.y) * 16.0;
        vec2 cell = floor(g);
        float h1 = hash12(cell);
        float h2 = hash12(cell + vec2(17.0, 3.0));
        float h3 = hash12(cell + vec2(5.0, 29.0));
        vec2 dv = g - (cell + vec2(0.3 + 0.4 * h1, 0.3 + 0.4 * h2));
        float shows = smoothstep(0.45, 0.6, hash12(cell + vec2(7.0, 41.0)));
        float life = pow(0.5 + 0.5 * sin(t * 5.0 + h3 * 6.2831853), 3.0);
        float point = exp(-dot(dv, dv) * 90.0);
        float flare = exp(-abs(dv.x) * 8.0) * exp(-dv.y * dv.y * 1200.0) + exp(-abs(dv.y) * 8.0) * exp(-dv.x * dv.x * 1200.0);
        float glint = (point * 0.9 + flare * 0.8) * life * shows * trail;
        vec3 hot = vec3(1.0, 0.97, 0.9);
        col += u_fx12.rgb * (body * 0.55 * (1.0 - p * 0.4) + bloom + glint * 1.6) + hot * u_fx12.rgb * core * 0.7;
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
