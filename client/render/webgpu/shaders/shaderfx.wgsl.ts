/**
 * WGSL for shaderFxPass.ts: the Shader Effects plugin's screen pass. One fullscreen triangle that
 * reads the scene, bends and tints it, and writes it back.
 *
 * Every effect is driven by the Fx uniform block (ShaderFxState.ts lays it out, slot by slot);
 * an effect whose strength is 0 costs one branch. All sampling is textureSampleLevel so it can sit
 * in non-uniform control flow. Effect strengths are already scaled by the user's intensity.
 *
 * The effects work in linear light. 117 HD hands over linear HDR as it is and takes linear HDR
 * back for its tonemap; the core renderer hands over display colour (grade.z = 1), which is
 * linearised on every read and encoded again on the way out.
 */
export const SHADERFX_WGSL = `
struct Fx {
    screen: vec4<f32>,    // width, height, 1/width, 1/height
    time: vec4<f32>,      // seconds, aspect (w/h), 0, 0
    taken: vec4<f32>,     // damage vignette, big-hit colour split, big-hit shake, shockwave progress (<0 off)
    dealt: vec4<f32>,     // hit punch, low health, special flash, level-up strength
    events: vec4<f32>,    // level-up ring progress (<0 off), poison, ranged focus, glitch
    spell: vec4<f32>,     // spell glow rgb, strength
    dmg: vec4<f32>,       // damage colour rgb, shockwave strength
    lookA: vec4<f32>,     // grain, scanlines, vignette, lens fringe
    lookB: vec4<f32>,     // sharpen, tilt shift, pixel size (0 off), posterize levels (0 off)
    grade: vec4<f32>,     // grade index, grade strength, 1 when the input is display colour (0 for linear HDR), 0
};

@group(0) @binding(0) var<uniform> fx: Fx;
@group(1) @binding(0) var t_scene: texture_2d<f32>;
@group(1) @binding(1) var s_scene: sampler;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn hash12(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn sceneAt(uv: vec2<f32>) -> vec3<f32> {
    let c = textureSampleLevel(t_scene, s_scene, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
    if (fx.grade.z > 0.5) {
        return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
    }
    return c;
}

fn saturate3(c: vec3<f32>, amount: f32) -> vec3<f32> {
    return mix(vec3<f32>(luma(c)), c, amount);
}

// The whole-picture colour grades. g is the scene's brightness, used to split shadows and lights.
fn grade(c: vec3<f32>, index: i32) -> vec3<f32> {
    let g = clamp(luma(c), 0.0, 1.0);
    switch index {
        case 1: { // warm
            return c * vec3<f32>(1.10, 1.0, 0.86);
        }
        case 2: { // cool
            return c * vec3<f32>(0.88, 1.0, 1.14);
        }
        case 3: { // noir: near monochrome with punchy contrast
            let m = (luma(c) - 0.18) * 1.35 + 0.18;
            return mix(c, vec3<f32>(max(m, 0.0)), 0.92);
        }
        case 4: { // sepia
            return vec3<f32>(luma(c)) * vec3<f32>(1.25, 1.0, 0.76);
        }
        case 5: { // teal shadows, orange lights
            let t = mix(vec3<f32>(0.80, 1.0, 1.15), vec3<f32>(1.20, 1.0, 0.80), smoothstep(0.08, 0.85, g));
            return c * t;
        }
        case 6: { // vivid
            return (saturate3(c, 1.55) - 0.18) * 1.12 + 0.18;
        }
        case 7: { // dreamy: lifted blacks, softer colour, a cool-warm drift
            return saturate3(c, 0.8) * 0.9 + vec3<f32>(0.035, 0.025, 0.05);
        }
        case 8: { // vaporwave: magenta shadows, cyan lights
            let t = mix(vec3<f32>(1.25, 0.65, 1.15), vec3<f32>(0.70, 1.15, 1.25), smoothstep(0.05, 0.8, g));
            return saturate3(c, 1.2) * t;
        }
        default: {
            return c;
        }
    }
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
    let t = fx.time.x;
    let aspect = fx.time.y;
    var uv = frag.xy * fx.screen.zw;

    // Pixelate: snap to the middle of a block.
    if (fx.lookB.z > 0.5) {
        let cell = fx.lookB.z * fx.screen.zw;
        uv = (floor(uv / cell) + vec2<f32>(0.5)) * cell;
    }

    let centre = vec2<f32>(0.5, 0.5);
    let d0 = uv - centre;
    let r = length(vec2<f32>(d0.x * aspect, d0.y)); // 0 in the middle, about 0.9 in a corner

    // Warps: poison wobble, hit shake, punch zoom, shockwave ring, glitch tears.
    if (fx.events.y > 0.0) {
        uv = uv + fx.events.y * 0.0035 * vec2<f32>(sin(uv.y * 38.0 + t * 3.1), cos(uv.x * 33.0 + t * 2.3));
    }
    if (fx.taken.z > 0.0) {
        uv = uv + fx.taken.z * 0.011 * vec2<f32>(sin(t * 93.0), cos(t * 71.0));
    }
    if (fx.dealt.x > 0.0) {
        uv = centre + (uv - centre) * (1.0 - fx.dealt.x * 0.055);
    }
    if (fx.taken.w >= 0.0) {
        let p = fx.taken.w;
        let x = (r - p * 1.05) / 0.09;
        let ring = exp(-x * x) * (1.0 - p) * fx.dmg.w;
        uv = uv - normalize(d0 + vec2<f32>(0.00001, 0.0)) * ring * 0.03;
    }
    if (fx.events.w > 0.0) {
        let tick = floor(t * 22.0);
        let band = floor(uv.y * 26.0);
        let h = hash12(vec2<f32>(band, tick));
        if (h > 0.8) {
            uv.x = uv.x + (h - 0.9) * 0.34 * fx.events.w;
        }
    }

    let d = uv - centre;

    // Base sample with the colour split: the hit's, plus the lens fringe growing to the edges.
    let split = fx.taken.y * 0.03 + fx.lookA.w * 0.016 * r;
    let ca = d * split;
    var col = vec3<f32>(sceneAt(uv + ca).r, sceneAt(uv).g, sceneAt(uv - ca).b);

    // Radial blur towards the middle: ranged speed lines and the hit punch.
    let blurAmt = fx.events.z * 0.07 * smoothstep(0.1, 0.8, r) + fx.dealt.x * 0.05;
    if (blurAmt > 0.001) {
        var acc = col;
        for (var i = 1; i <= 6; i = i + 1) {
            acc = acc + sceneAt(uv - d * blurAmt * f32(i) / 6.0);
        }
        col = acc / 7.0;
    }

    // Tilt shift: blur grows away from a sharp band across the middle.
    if (fx.lookB.y > 0.0) {
        let rad = fx.lookB.y * smoothstep(0.12, 0.5, abs(uv.y - 0.5)) * 0.007;
        if (rad > 0.0002) {
            var acc = vec3<f32>(0.0);
            for (var i = 0; i < 8; i = i + 1) {
                let a = f32(i) * 0.7853982;
                acc = acc + sceneAt(uv + vec2<f32>(cos(a) / aspect, sin(a)) * rad);
            }
            col = mix(col, acc / 8.0, min(1.0, fx.lookB.y));
        }
    }

    // Sharpen: add back what a 1px box blur takes away.
    if (fx.lookB.x > 0.0) {
        let px = fx.screen.zw;
        let blur = (sceneAt(uv + vec2<f32>(px.x, 0.0)) + sceneAt(uv - vec2<f32>(px.x, 0.0))
            + sceneAt(uv + vec2<f32>(0.0, px.y)) + sceneAt(uv - vec2<f32>(0.0, px.y))) * 0.25;
        col = col + (col - blur) * fx.lookB.x * 0.8;
    }

    // Poison: a green cast, thicker at the edges.
    if (fx.events.y > 0.0) {
        let edge = smoothstep(0.2, 0.9, r);
        col = mix(col, col * vec3<f32>(0.72, 1.12, 0.62), fx.events.y * 0.45);
        col = col + vec3<f32>(0.02, 0.18, 0.02) * fx.events.y * edge;
    }

    // Low health: the colour drains and a red edge beats like a pulse.
    if (fx.dealt.y > 0.0) {
        let beat = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(t * 5.6), 3.0);
        let edge = smoothstep(0.18, 0.85, r);
        col = saturate3(col, 1.0 - fx.dealt.y * 0.45);
        col = col + fx.dmg.rgb * fx.dealt.y * beat * edge * 0.9;
        col = col * (1.0 - fx.dealt.y * 0.22 * edge);
    }

    // Damage vignette.
    if (fx.taken.x > 0.0) {
        let edge = smoothstep(0.12, 0.8, r);
        col = mix(col, col * 0.45 + fx.dmg.rgb * 0.9, fx.taken.x * edge * 0.7);
        col = col + fx.dmg.rgb * fx.taken.x * 0.06;
    }

    // Special attack: a golden flash from the middle.
    if (fx.dealt.z > 0.0) {
        let gold = vec3<f32>(1.0, 0.74, 0.22);
        col = col + gold * fx.dealt.z * (0.55 * exp(-r * r * 6.0) + 0.1 + 0.25 * smoothstep(0.3, 0.9, r));
    }

    // Spell glow: the spell's colour blooms from the middle and rims the screen.
    if (fx.spell.w > 0.0) {
        col = col + fx.spell.rgb * fx.spell.w * (0.45 * exp(-r * r * 4.0) + 0.3 * smoothstep(0.3, 0.95, r));
    }

    // Level-up: an expanding golden ring over a soft glow.
    if (fx.events.x >= 0.0) {
        let p = fx.events.x;
        let x = (r - p * 1.1) / 0.07;
        let ring = exp(-x * x);
        col = col + vec3<f32>(1.0, 0.86, 0.35) * fx.dealt.w * (ring * 1.6 * (1.0 - p) + 0.18 * exp(-r * r * 3.0));
    }

    // Always-on: vignette, grade, scanlines, grain, posterize.
    if (fx.lookA.z > 0.0) {
        col = col * (1.0 - fx.lookA.z * 0.62 * smoothstep(0.3, 1.0, r));
    }
    if (fx.grade.y > 0.0) {
        col = mix(col, grade(col, i32(fx.grade.x + 0.5)), fx.grade.y);
    }
    if (fx.lookB.w > 0.5) {
        let levels = fx.lookB.w;
        let display = pow(max(col, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
        col = pow(floor(display * levels + 0.5) / levels, vec3<f32>(2.2));
    }
    if (fx.lookA.y > 0.0 && u32(frag.y) % 3u == 0u) {
        col = col * (1.0 - fx.lookA.y * 0.38);
    }
    if (fx.lookA.x > 0.0) {
        let n = hash12(frag.xy + fract(t) * vec2<f32>(137.1, 91.7)) - 0.5;
        col = col + n * fx.lookA.x * 0.1 * (0.35 + luma(col));
    }

    var result = max(col, vec3<f32>(0.0));
    if (fx.grade.z > 0.5) {
        result = pow(min(result, vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
    }
    return vec4<f32>(result, 1.0);
}
`;
