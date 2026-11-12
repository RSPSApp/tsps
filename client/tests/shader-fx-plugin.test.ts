import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { INV, WORN } from "@runelite/api/gameval/InventoryID";
import { SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { COLOR_GRADE_INDEX, ShaderFxConfig } from "../game/plugins/shaderfx/ShaderFxConfig";
import { ShaderFxPlugin } from "../game/plugins/shaderfx/ShaderFxPlugin";
import {
    FxDuration,
    FxSlot,
    SHADER_FX_UNIFORM_FLOATS,
    ShaderFxState,
    fade,
    graphicColor,
    lootColor,
    rampFade,
    teleportWarp,
} from "../game/plugins/shaderfx/ShaderFxState";
import { SHADERFX_WGSL } from "../render/webgpu/shaders/shaderfx.wgsl";
import { SkillId } from "../rs/skill/skills";

// --- Config ---------------------------------------------------------------------------------------
assert.equal(ShaderFxConfig.group, "shaderfx");
assert.equal(ShaderFxPlugin.descriptor.name, "Shader Effects");
assert.equal(ShaderFxPlugin.descriptor.enabledByDefault, false, "optional: off until the player turns it on");
for (const [key, item] of Object.entries(ShaderFxConfig.items)) {
    assert.ok(item.name && item.description, `${key} has a name and a description`);
    if (item.section) assert.ok(ShaderFxConfig.sections?.[item.section], `${key} points at a real section`);
}
for (const key of ["filmGrain", "scanlines", "staticVignette", "staticChromatic", "sharpen", "tiltShift", "pixelate", "posterize"]) {
    assert.equal(ShaderFxConfig.items[key].default, false, `${key}: the always-on looks start off`);
}

// --- Decay curve ------------------------------------------------------------------------------------
assert.equal(fade(0, 100), 1);
assert.equal(fade(100, 100), 0);
assert.equal(fade(-5, 100), 0, "an impulse in the future has not started");
assert.ok(fade(50, 100) < 0.5 && fade(50, 100) > 0, "eases out");
const [r, g, b] = graphicColor(1234);
assert.ok([r, g, b].every((c) => c >= 0 && c <= 1), "graphic colours are valid rgb");
assert.notDeepEqual(graphicColor(1), graphicColor(2), "neighbouring graphics differ");

// --- State -> uniforms -------------------------------------------------------------------------------
const defaults = {
    intensity: 1, damageVignette: true, damageColor: 0xd01818, hitChromatic: true, hitShake: true,
    hitShockwave: true, hitGlitch: false, bigHitDamage: 15, lowHealth: true, lowHealthPercent: 25,
    dealPunch: true, dealMinDamage: 8, specFlash: true, castGlow: true, castColor: 0x6a5cff,
    castHueFromGraphic: false, rangedFocus: true, levelUpBurst: true, poisonTint: true,
    colorGrade: "none" as const, filmGrain: false, scanlines: false, staticVignette: false,
    staticChromatic: false, sharpen: false, tiltShift: false, pixelate: false, posterize: false,
    inkOutlines: false, prayerAura: true, freezeEffect: true, thornsEffect: true, teleportWarp: true,
    lootFlash: true, lootFlashValue: 100_000,
};
const out = new Float32Array(SHADER_FX_UNIFORM_FLOATS);

let state = new ShaderFxState();
assert.equal(state.fill(out, defaults, 1000), false, "nothing happening: nothing to draw");
assert.equal(out[FxSlot.TAKEN + 3], -1, "no shockwave");
assert.equal(out[FxSlot.EVENTS], -1, "no level-up ring");

assert.deepEqual(
    [out[FxSlot.DAMAGE_COLOR], out[FxSlot.DAMAGE_COLOR + 1], out[FxSlot.DAMAGE_COLOR + 2]].map((v) => Math.round(v * 255)),
    [0xd0, 0x18, 0x18],
    "the damage colour is unpacked into the block",
);

state.hitTaken(5, 15, 1000);
assert.equal(state.fill(out, defaults, 1000), true);
assert.ok(out[FxSlot.TAKEN] > 0, "a small hit flashes the vignette");
assert.equal(out[FxSlot.TAKEN + 1], 0, "but does not split colours");
assert.equal(out[FxSlot.TAKEN + 3], -1, "or ripple");
assert.equal(state.fill(out, defaults, 1000 + FxDuration.DAMAGE + 1), false, "and it fades out");

state = new ShaderFxState();
state.hitTaken(40, 15, 2000);
state.fill(out, defaults, 2000);
assert.ok(out[FxSlot.TAKEN + 1] > 0 && out[FxSlot.TAKEN + 2] > 0, "a big hit splits colours and shakes");
state.fill(out, defaults, 2100);
assert.ok(out[FxSlot.TAKEN + 3] > 0 && out[FxSlot.TAKEN + 3] < 1, "the shockwave travels");
state.fill(out, { ...defaults, hitChromatic: false, hitShake: false, hitShockwave: false, damageVignette: false }, 2000);
assert.equal(out[FxSlot.TAKEN] + out[FxSlot.TAKEN + 1] + out[FxSlot.TAKEN + 2], 0, "each toggle turns its effect off");
assert.equal(out[FxSlot.TAKEN + 3], -1);
state.fill(out, { ...defaults, hitGlitch: true }, 2000);
assert.ok(out[FxSlot.EVENTS + 3] > 0, "glitch is its own toggle");
assert.equal(state.fill(out, { ...defaults, intensity: 0 }, 2000), false, "intensity 0 is off");

state = new ShaderFxState();
state.hitDealt(3, 8, 0);
assert.equal(state.fill(out, defaults, 0), false, "a hit under the threshold does not punch");
state.hitDealt(20, 8, 0);
state.fill(out, defaults, 10);
assert.ok(out[FxSlot.DEALT] > 0, "a solid hit punches");

state.setHealth(30, 100);
assert.equal(state.fill(out, defaults, 5000), false, "30% is above the 25% warning");
state.setHealth(10, 100);
assert.equal(state.fill(out, defaults, 5000), true);
assert.ok(out[FxSlot.DEALT + 1] > 0, "low health warns");
state.setHealth(1, 100);
const nearDeath = out[FxSlot.DEALT + 1];
state.fill(out, defaults, 5000);
assert.ok(out[FxSlot.DEALT + 1] > nearDeath, "and more the lower it is");

state = new ShaderFxState();
state.setPoisoned(true);
state.fill(out, defaults, 0);
assert.ok(out[FxSlot.EVENTS + 1] > 0, "poison haze while poisoned");
state.cast(7, 100, { castHueFromGraphic: false, castColor: 0xff0000 });
state.fill(out, defaults, 100);
assert.deepEqual([out[FxSlot.CAST], out[FxSlot.CAST + 1], out[FxSlot.CAST + 2]], [1, 0, 0], "the chosen spell colour");
assert.ok(out[FxSlot.CAST + 3] > 0, "glow strength");
state.levelUp(0);
state.fill(out, defaults, 100);
assert.ok(out[FxSlot.EVENTS] >= 0 && out[FxSlot.DEALT + 3] > 0, "level-up ring");

state = new ShaderFxState();
const looks = { ...defaults, filmGrain: true, pixelate: true, posterize: true, colorGrade: "noir" as const };
assert.equal(state.fill(out, looks, 0), true, "always-on looks keep the pass running");
assert.ok(out[FxSlot.LOOK_A] > 0 && out[FxSlot.LOOK_B + 2] > 0 && out[FxSlot.LOOK_B + 3] > 0);
assert.equal(out[FxSlot.GRADE], 3, "noir");

// --- New effects: freeze, thorns, teleport, loot, aura, ink, grades --------------------------------------
assert.equal(rampFade(-1, 1000, 100), 0);
assert.equal(rampFade(1000, 1000, 100), 0);
assert.ok(rampFade(50, 1000, 100) < rampFade(100, 1000, 100), "rises over the ramp");
assert.ok(rampFade(100, 1000, 100) > rampFade(900, 1000, 100), "then drains");
assert.equal(rampFade(300, 1000, 100, 0.35), 1, "holds at full for its share of the duration");
assert.ok(rampFade(800, 1000, 100, 0.35) < 1, "and then drains");
assert.equal(lootColor(99_999, 100_000), undefined, "under the threshold: no flash");
assert.deepEqual(lootColor(100_000, 100_000), [1, 0.8, 0.28], "gold from the threshold");
assert.deepEqual(lootColor(1_000_000, 100_000), [0.8, 0.35, 1], "purple from ten times it");

state = new ShaderFxState();
assert.equal(state.fill(out, defaults, 0), false);
state.frozen(1000);
assert.equal(state.fill(out, defaults, 1400), true);
assert.ok(out[FxSlot.STATUS] > 0 && out[FxSlot.STATUS + 1] === 0, "freeze is its own slot");
assert.equal(state.fill(out, { ...defaults, freezeEffect: false }, 1400), false, "freeze has a toggle");
assert.equal(state.fill(out, defaults, 1000 + FxDuration.FREEZE), false, "and ends");
state.entangled(5000);
assert.ok(state.fill(out, defaults, 5400) && out[FxSlot.STATUS + 1] > 0 && out[FxSlot.STATUS] === 0, "thorns are separate");
assert.equal(state.fill(out, { ...defaults, thornsEffect: false }, 5400), false);
// Teleport: builds while the teleport plays, holds until the landing, then settles back.
assert.equal(teleportWarp(0, -1e9, -1e9), 0, "no teleport: nothing");
const windUp = (ms: number) => teleportWarp(10_000 + ms, 10_000, -1e9);
assert.ok(windUp(300) > 0 && windUp(300) < windUp(1000), "the wind-up builds");
assert.equal(windUp(FxDuration.TELEPORT_WINDUP), 1, "to full strength");
assert.equal(windUp(FxDuration.TELEPORT_WINDUP + 1000), 1, "and holds until the landing");
assert.equal(windUp(FxDuration.TELEPORT_TIMEOUT), 0, "a wind-up with no landing gives up");
const landed = (ms: number) => teleportWarp(20_000 + ms, 10_000, 20_000);
assert.equal(landed(0), 1, "the landing starts where the wind-up ended");
assert.ok(landed(500) < 1 && landed(500) > 0, "then it settles back");
assert.equal(landed(FxDuration.TELEPORT_LAND), 0, "and ends");
state = new ShaderFxState();
state.teleportStarted(9000);
assert.ok(state.fill(out, defaults, 9900) && out[FxSlot.STATUS + 2] > 0, "teleport warp while it plays");
const windingStrength = out[FxSlot.STATUS + 2];
assert.ok(state.fill(out, defaults, 10_800) && out[FxSlot.STATUS + 2] > windingStrength, "stronger the longer it winds");
assert.equal(state.fill(out, { ...defaults, teleportWarp: false }, 9900), false);
state.teleported(11_000);
assert.ok(state.fill(out, defaults, 11_300) && out[FxSlot.STATUS + 2] > 0, "the landing settles back");
assert.equal(out[FxSlot.FOCUS + 3], 0, "and nothing whites the picture out");
assert.equal(state.fill(out, defaults, 11_000 + FxDuration.TELEPORT_LAND), false);
state.teleported(14_000);
assert.ok(state.fill(out, defaults, 14_100) && out[FxSlot.STATUS + 2] > 0, "a teleport with no wind-up only plays the landing");

// Prayer haze follows the player's spot on screen
state = new ShaderFxState();
state.setPrayerAura([1, 0.3, 0.2]);
state.fill(out, defaults, 0);
assert.deepEqual([out[FxSlot.FOCUS], out[FxSlot.FOCUS + 1]], [0.5, 0.5], "no spot known: the middle");
state.setPlayerScreen({ u: 0.3, v: 0.6, radius: 0.1 });
state.fill(out, defaults, 0);
assert.deepEqual([out[FxSlot.FOCUS], out[FxSlot.FOCUS + 1], out[FxSlot.FOCUS + 2]].map((v) => Math.round(v * 10)), [3, 6, 1]);
assert.ok(state.hasPrayerAura());
state.setPrayerAura(undefined);
assert.equal(state.hasPrayerAura(), false);

state.lootDropped(50_000, 100_000, 12_000);
assert.equal(state.fill(out, defaults, 12_100), false, "a cheap drop is ignored");
assert.equal(out[FxSlot.LOOT + 3], -1);
state.lootDropped(250_000, 100_000, 12_000);
assert.ok(state.fill(out, defaults, 12_300), "a valuable drop flashes");
assert.ok(out[FxSlot.LOOT + 3] > 0 && out[FxSlot.LOOT + 3] < 1, "the sweep travels");
assert.deepEqual([out[FxSlot.LOOT], out[FxSlot.LOOT + 1], out[FxSlot.LOOT + 2]].map((v) => Math.round(v * 100)), [100, 80, 28]);
assert.equal(state.fill(out, { ...defaults, lootFlash: false }, 12_300), false);
assert.equal(state.fill(out, defaults, 12_000 + FxDuration.LOOT), false);
assert.equal(out[FxSlot.LOOT + 3], -1, "no sweep when over");

state.setPrayerAura([0.3, 0.6, 1]);
assert.ok(state.fill(out, defaults, 20_000) && out[FxSlot.AURA + 3] > 0, "an active prayer glows");
assert.deepEqual([out[FxSlot.AURA], out[FxSlot.AURA + 2]].map((v) => Math.round(v * 10)), [3, 10]);
assert.equal(state.fill(out, { ...defaults, prayerAura: false }, 20_000), false);
state.setPrayerAura(undefined);
assert.equal(state.fill(out, defaults, 20_000), false, "prayers off: no aura");

assert.ok(state.fill(out, { ...defaults, inkOutlines: true }, 0) && out[FxSlot.STATUS + 3] > 0, "ink outlines");
for (const [name, index] of Object.entries(COLOR_GRADE_INDEX)) {
    assert.equal(COLOR_GRADE_INDEX[name as keyof typeof COLOR_GRADE_INDEX], index);
}
assert.equal(new Set(Object.values(COLOR_GRADE_INDEX)).size, Object.keys(COLOR_GRADE_INDEX).length, "every grade has its own index");
assert.equal(Math.max(...Object.values(COLOR_GRADE_INDEX)), 16);
for (const index of Object.values(COLOR_GRADE_INDEX)) {
    if (index > 0) assert.ok(SHADERFX_WGSL.includes(`case ${index}:`), `WGSL has grade ${index}`);
}
assert.equal(ShaderFxConfig.items.inkOutlines.default, false, "ink outlines start off");

// --- Shader source: every uniform field the state fills is declared ----------------------------------
for (const field of [
    "screen", "time", "taken", "dealt", "events", "spell", "dmg", "lookA", "lookB", "grade", "status", "aura", "loot", "focus",
]) {
    assert.ok(SHADERFX_WGSL.includes(`${field}: vec4<f32>`), `shader declares ${field}`);
}
assert.equal((SHADERFX_WGSL.match(/: vec4<f32>,\s+\/\//g) ?? []).length * 4, SHADER_FX_UNIFORM_FLOATS);

// --- Plugin: game events become impulses -------------------------------------------------------------
let now = 10_000;
let hp = 100;
let spec = 1000;
let poison = 0;
let level = 50;
let weaponType = 0;
let playerX = 3200;
let prayerVarbits: Record<number, number> = {};
let groundListener: ((event: any) => void) | undefined;
let serverTick = 5000;
/** The inventory (INV) and worn items (WORN) as item id -> quantity. */
const held: Record<number, Record<number, number>> = { [INV]: {}, [WORN]: {} };
const client = {
    getItemContainer: (id: number) => ({
        count: (item: number) => held[id]?.[item] ?? 0,
        getItems: () => Object.entries(held[id] ?? {}).map(([item, quantity]) => ({ getId: () => Number(item), getQuantity: () => quantity })),
    }),
    getLocalPlayer: () => ({ getWorldLocation: () => ({ getX: () => playerX, getY: () => 3200 }) }),
    getBoostedSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? hp : 1),
    getRealSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? 100 : skill === SkillId.Attack ? level : 1),
    getVarpValue: (id: number) => (id === SA_ENERGY ? spec : id === 102 ? poison : 0),
    getVarbitValue: (id: number) => (id === 357 ? weaponType : prayerVarbits[id] ?? 0),
} as unknown as Client;
const plugin = new ShaderFxPlugin({
    client,
    localPlayerId: () => 7,
    now: () => now,
    currentTick: () => serverTick,
    subscribeGroundItems: (listener) => {
        groundListener = listener;
        return () => { groundListener = undefined; };
    },
});
assert.equal(plugin.shaderFx(), undefined, "no handle while the plugin is off");
plugin.setEnabledState(true);
const runtime = plugin.shaderFx()!;
assert.ok(runtime, "a handle while on");
assert.equal(runtime.fill(out), false);

plugin.onGameTick(); // baselines
plugin.handleHitsplat({ targetType: "player", targetId: 7, damage: 30 });
assert.equal(runtime.fill(out), true);
assert.ok(out[FxSlot.TAKEN] > 0, "a hit on you");
now += 5000;
plugin.handleHitsplat({ targetType: "player", targetId: 99, damage: 30 });
assert.equal(runtime.fill(out), false, "someone else's hit is not yours");
plugin.handleHitsplat({ targetType: "npc", targetId: 5, damage: 25 });
assert.ok(out[FxSlot.DEALT] >= 0 && runtime.fill(out) && out[FxSlot.DEALT] > 0, "a hit on an NPC punches");

now += 5000;
plugin.onGameTick();
spec = 750;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.DEALT + 2] > 0, "spending special energy flashes");
now += 5000;
spec = 760; // regenerating is not a spend
plugin.onGameTick();
assert.equal(runtime.fill(out), false);
level = 51;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.DEALT + 3] > 0, "a level up bursts");
now += 5000;
poison = 6;
hp = 10;
plugin.onGameTick();
assert.ok(runtime.fill(out) && out[FxSlot.EVENTS + 1] > 0 && out[FxSlot.DEALT + 1] > 0, "poisoned and low");
poison = 0;
hp = 100;
plugin.onGameTick();
assert.equal(runtime.fill(out), false, "back to normal");
// A negative varp 102 is an antipoison's immunity timer: not poisoned.
poison = -5;
plugin.onGameTick();
assert.equal(runtime.fill(out), false, "antipoison immunity is not poison");
poison = 0;

// Ranged shot vs spell: both send a projectile and a graphic on the player a few ms apart.
const launch = { source: { actor: { kind: "player", serverId: 7 } } } as never;
const fire = (order: "projectileFirst" | "graphicFirst", weapon: number) => {
    now += 10_000;
    weaponType = weapon;
    plugin.state.reset();
    const projectile = () => (plugin as any).onProjectile(launch);
    const graphic = () => (plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 19 });
    if (order === "projectileFirst") { projectile(); now += 4; graphic(); } else { graphic(); now += 4; projectile(); }
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    return { ranged: o[FxSlot.EVENTS + 2], spell: o[FxSlot.CAST + 3] };
};
for (const order of ["projectileFirst", "graphicFirst"] as const) {
    const bow = fire(order, 3);
    assert.ok(bow.ranged > 0 && bow.spell === 0, `a bow's shot is ranged focus, not a spell (${order})`);
    const staff = fire(order, 18);
    assert.ok(staff.spell > 0 && staff.ranged === 0, `a staff's cast is a spell glow, not ranged focus (${order})`);
}
weaponType = 18;
now += 10_000;
plugin.state.reset();
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 1234 });
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    assert.ok(o[FxSlot.CAST + 3] > 0, "a self-cast (no projectile) glows");
}

// Ice and entangle graphics on you are statuses, not spell casts.
now += 10_000;
plugin.state.reset();
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 369 });
now += 80;
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    assert.ok(o[FxSlot.STATUS] > 0 && o[FxSlot.CAST + 3] === 0, "Ice Barrage on you freezes, with no spell glow");
}
now += 10_000;
plugin.state.reset();
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 179 });
(plugin as any).onGraphic({ type: "npc", serverId: 7, graphic: 369 });
now += 80;
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    assert.ok(o[FxSlot.STATUS + 1] > 0 && o[FxSlot.STATUS] === 0 && o[FxSlot.CAST + 3] === 0, "Entangle on you roots; an NPC's graphic does nothing");
}

// Prayer aura reads the prayer varbits each tick.
now += 10_000;
plugin.state.reset();
prayerVarbits = { 4118: 1 };
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.ok(runtime.fill(o) && o[FxSlot.AURA + 3] > 0 && o[FxSlot.AURA] > o[FxSlot.AURA + 2], "Protect from Melee glows red");
}
prayerVarbits = { 4116: 1, 4117: 1 };
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    assert.ok(o[FxSlot.AURA + 1] > o[FxSlot.AURA], "two prayers blend");
}
prayerVarbits = {};
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.equal(runtime.fill(o), false, "prayers off: no aura");
}

// A teleport graphic on you winds the warp up before you move, with no spell glow.
now += 10_000;
plugin.state.reset();
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 111 });
now += 900;
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.ok(runtime.fill(o) && o[FxSlot.STATUS + 2] > 0 && o[FxSlot.CAST + 3] === 0, "the wind-up starts on the cast, not the landing");
}
(plugin as any).onGraphic({ type: "npc", serverId: 7, graphic: 111 });
// A long jump between ticks is a teleport; a run is not.
now += 10_000;
plugin.state.reset();
plugin.onGameTick();
playerX += 2;
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.equal(runtime.fill(o), false, "running two tiles is not a teleport");
}
playerX += 6400; // a ladder or trapdoor into a dungeon: no teleport graphic came first
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.equal(runtime.fill(o), false, "a long move with no teleport graphic is not a teleport landing");
}
now += 400;
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 111 }); // a teleport cast right after a jump
now += 900;
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.ok(runtime.fill(o) && o[FxSlot.STATUS + 2] > 0, "a teleport cast soon after a jump still winds up");
}
now += 5000;
(plugin as any).onGraphic({ type: "player", serverId: 7, graphic: 111 });
now += 900;
playerX += 40;
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.ok(runtime.fill(o) && o[FxSlot.STATUS + 2] > 0, "a teleport graphic then a 40 tile jump warps");
}
now += 10_000;
plugin.state.reset();
plugin.onGameTick();
playerX += 40; // the same jump with no wind-up: `::tele`, or a boat
plugin.onGameTick();
{
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    assert.equal(runtime.fill(o), false, "a landing with no wind-up before it is ignored");
}

// Loot: only a new drop of yours worth the threshold flashes, not your own drops, your death pile,
// a stack a region snapshot brings back, or one you left behind.
const stack = (id: number, ownership: number, gePrice: number, quantity = 1, itemId = id, createdTick = serverTick) => ({
    id, itemId, ownership, gePrice, quantity, createdTick,
});
const drop = (kind: string, spawned: ReturnType<typeof stack>) => groundListener!({ kind, stack: spawned });
const tick = () => {
    now += 600;
    serverTick++;
    plugin.onGameTick();
};
/** Lets the plugin judge the stacks that just appeared. */
const settle = () => {
    tick();
    tick();
};
const flashing = () => {
    const o = new Float32Array(SHADER_FX_UNIFORM_FLOATS);
    runtime.fill(o);
    return o[FxSlot.LOOT + 3] >= 0;
};
const fresh = () => {
    now += 10_000;
    plugin.state.reset();
    held[INV] = {};
    held[WORN] = {};
    settle();
    plugin.state.reset();
};
void (plugin as any).startUp();
assert.ok(groundListener, "the plugin listens to the ground items once started");
fresh();
drop("spawn", stack(1, 2, 5_000_000));
settle();
assert.equal(flashing(), false, "someone else's loot does not flash");
drop("spawn", stack(2, 1, 20_000, 3));
settle();
assert.equal(flashing(), false, "60k in total is under the threshold");
drop("spawn", stack(3, 1, 20_000, 10));
assert.equal(flashing(), false, "a stack is judged a couple of ticks after it appears");
settle();
assert.equal(flashing(), true, "price times quantity counts");

fresh();
drop("despawn", stack(4, 1, 9_000_000));
now += 20;
drop("spawn", stack(4, 1, 9_000_000));
settle();
assert.equal(flashing(), false, "a snapshot's despawn and re-add is not a drop");
drop("spawn", stack(5, 1, 9_000_000, 1, 5, serverTick - 50));
settle();
assert.equal(flashing(), false, "a stack that was made long ago is one you walked back to, not a drop");
// The login snapshot arrives before the first tick message, when the client's tick is still 0.
fresh();
const loginTick = serverTick;
serverTick = 0;
drop("spawn", stack(10, 1, 9_000_000, 1, 10, 0));
settle();
serverTick = loginTick + 3;
settle();
assert.equal(flashing(), false, "your own stack in the login snapshot, before the first tick, is not a drop");

// Dropping an item of your own: it leaves the inventory as the stack appears.
fresh();
held[INV] = { 7: 1 };
tick();
held[INV] = {};
drop("spawn", stack(6, 1, 9_000_000, 1, 7));
settle();
assert.equal(flashing(), false, "an item you drop from your inventory is not loot");
// Dying: the inventory and the worn items all become a pile.
fresh();
held[INV] = { 7: 1 };
held[WORN] = { 8: 1 };
tick();
held[INV] = {};
held[WORN] = {};
drop("spawn", stack(7, 1, 9_000_000, 1, 7));
drop("spawn", stack(8, 1, 9_000_000, 1, 8));
settle();
assert.equal(flashing(), false, "a death pile is not loot");
// Dropping the moment the plugin turns on: starting it records the inventory as a baseline.
fresh();
held[INV] = { 7: 1 };
void (plugin as any).startUp();
held[INV] = {};
drop("spawn", stack(11, 1, 9_000_000, 1, 7));
settle();
assert.equal(flashing(), false, "dropping an item right after the plugin turns on is not loot");
// A real drop: the inventory keeps what it had, even when it already holds the same item.
fresh();
held[INV] = { 7: 1 };
tick();
drop("spawn", stack(9, 1, 9_000_000, 1, 7));
settle();
assert.equal(flashing(), true, "a drop that does not come out of your inventory flashes");

void (plugin as any).shutDown();
assert.equal(groundListener, undefined, "and stops listening when shut down");
plugin.setEnabledState(false);
assert.equal(plugin.shaderFx(), undefined);
console.log("shader-fx-plugin: ok");
