import { strict as assert } from "node:assert";
import type { Actor, Client, NPC, Player } from "@runelite/api/Client";
import { GameStateChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import * as AnimationID from "@runelite/api/gameval/AnimationID";
import * as VarPlayerID from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { IdleNotifierConfig } from "../game/plugins/idlenotifier/IdleNotifierConfig";
import { IdleNotifierPlugin } from "../game/plugins/idlenotifier/IdleNotifierPlugin";
import { IDLE_NOTIFIER_ANIMATIONS } from "../game/plugins/idlenotifier/idleAnimations";
import { InputManager } from "../game/InputManager";
import { ChatPastePlugin } from "../game/plugins/chatpaste/ChatPastePlugin";
import { ClientImpl } from "../runelite/impl/ClientImpl";
import { SkillId } from "../rs/skill/skills";

// --- Config: RuneLite's group and keys ----------------------------------------------------------
assert.equal(IdleNotifierConfig.group, "idlenotifier");
assert.equal(IdleNotifierConfig.items.animationIdle.keyName, "animationidle");
assert.equal(IdleNotifierConfig.items.getIdleNotificationDelay.keyName, "timeout");
assert.equal(IdleNotifierConfig.items.getIdleNotificationDelay.default, 5000);
assert.equal(IdleNotifierConfig.items.movementIdle.default, false);
assert.equal(IdleNotifierPlugin.descriptor.enabledByDefault, false, "off by default, as RuneLite");
assert.ok(IDLE_NOTIFIER_ANIMATIONS.has(AnimationID.HUMAN_WOODCUTTING_RUNE_AXE));
assert.ok(IDLE_NOTIFIER_ANIMATIONS.has(AnimationID.HUMAN_MINING_DRAGON_PICKAXE));
assert.ok(!IDLE_NOTIFIER_ANIMATIONS.has(-1));

// --- A fake client the test drives ---------------------------------------------------------------
type State = {
    animation: number;
    interacting: Actor | null;
    x: number;
    hp: number;
    hpMax: number;
    prayer: number;
    prayerMax: number;
    energy: number;
    spec: number;
    lastPressed: number;
    keyboardIdleTicks: number;
};
const state: State = {
    animation: -1, interacting: null, x: 3200, hp: 50, hpMax: 50, prayer: 40, prayerMax: 40,
    energy: 10000, spec: 1000, lastPressed: -1e9, keyboardIdleTicks: 1000,
};
const player: Player = {
    getName: () => "Zezima",
    getCombatLevel: () => 100,
    getAnimation: () => state.animation,
    getWorldLocation: () => ({ x: state.x, y: 3200, plane: 0 }),
    getInteracting: () => state.interacting,
};
const client = {
    getGameState: () => GameState.LOGGED_IN,
    getLocalPlayer: () => player,
    getVarpValue: (id: number) => (id === VarPlayerID.SA_ENERGY ? state.spec : 0),
    getVarbitValue: () => 0,
    getRealSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? state.hpMax : state.prayerMax),
    getBoostedSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? state.hp : state.prayer),
    getEnergy: () => state.energy,
    getTickCount: () => 0,
    getMouseLastPressedMillis: () => state.lastPressed,
    getKeyboardIdleTicks: () => state.keyboardIdleTicks,
} as unknown as Client;

const npc = (key: number, name: string, actions: string[]): NPC => ({
    getId: () => 1,
    getIndex: () => key,
    getName: () => name,
    getInteractionKey: () => key,
    getComposition: () => ({ getName: () => name, getActions: () => actions }),
});

const config = inject(ConfigManager);
const sent: string[] = [];
const plugin = new IdleNotifierPlugin(client, { notify: (m) => sent.push(m) });
let clock = 100_000;
plugin.now = () => clock;
void plugin.start(); // startUp runs synchronously up to its first await
const tick = (ms = 600) => {
    clock += ms;
    plugin.onGameTick();
};

// --- Animation idle: busy with a skilling animation, then 5 s without one -----------------------
state.animation = AnimationID.HUMAN_WOODCUTTING_RUNE_AXE;
tick();
tick();
state.animation = -1;
tick();
for (let i = 0; i < 8; i++) tick();
assert.deepEqual(sent, [], "not before the delay");
tick();
assert.deepEqual(sent, ["You are now idle!"], "after the 5 s delay");
for (let i = 0; i < 20; i++) tick();
assert.equal(sent.length, 1, "once");

// An unknown animation (a weapon swing, say) is not idleness.
sent.length = 0;
state.animation = 422;
tick();
state.animation = -1;
for (let i = 0; i < 20; i++) tick();
assert.deepEqual(sent, [], "unknown animations never notify");

// A click within the last second keeps you active.
state.animation = AnimationID.HUMAN_FIRECOOKING;
tick();
state.animation = -1;
state.lastPressed = clock;
for (let i = 0; i < 20; i++) {
    tick();
    state.lastPressed = clock;
}
assert.deepEqual(sent, [], "clicking resets the timers");
state.lastPressed = -1e9;

// --- Interaction idle: out of combat, and fishing -----------------------------------------------
state.interacting = npc(5, "Goblin", ["Attack", null as unknown as string]);
tick();
state.interacting = null;
for (let i = 0; i < 20; i++) tick();
assert.deepEqual(sent, ["You are now out of combat!"]);

sent.length = 0;
state.interacting = npc(6, "Fishing spot", ["Net", "Bait"]);
tick();
state.interacting = null;
for (let i = 0; i < 20; i++) tick();
assert.deepEqual(sent, ["You are now idle!"], "fishing spots count as interactions");

sent.length = 0;
state.interacting = npc(7, "Banker", ["Talk-to", "Bank"]);
tick();
state.interacting = null;
for (let i = 0; i < 20; i++) tick();
assert.deepEqual(sent, [], "other NPCs don't");

// A hitsplat on you keeps you in combat for 8 ticks after the target goes.
state.interacting = npc(8, "Goblin", ["Attack"]);
tick();
state.interacting = null;
(plugin as any).osrsClient = { controlledPlayerServerId: 3 };
plugin.onHitsplat({ targetType: "player", targetId: 3, damage: 1 });
for (let i = 0; i < 7; i++) tick(1000);
assert.deepEqual(sent, [], "a recent hitsplat delays it");
for (let i = 0; i < 3; i++) tick(1000);
assert.deepEqual(sent, ["You are now out of combat!"]);
(plugin as any).osrsClient = undefined;

// --- Movement idle (off by default) ------------------------------------------------------------
sent.length = 0;
config.setConfigValue(IdleNotifierConfig, "movementIdle", true);
state.x = 3201;
tick();
state.x = 3202;
tick();
for (let i = 0; i < 10; i++) tick();
assert.deepEqual(sent, ["You have stopped moving!"]);
config.setConfigValue(IdleNotifierConfig, "movementIdle", false);

// --- Thresholds: hitpoints, prayer, energy, spec -------------------------------------------------
sent.length = 0;
config.setConfigValue(IdleNotifierConfig, "getHitpointsNotification", true);
config.setConfigValue(IdleNotifierConfig, "getHitpointsThreshold", 10);
tick();
state.hp = 10;
tick();
tick();
assert.deepEqual(sent, ["You have low hitpoints!"], "once when it drops to the threshold");
state.hp = 50;
tick();
state.hp = 5;
tick();
assert.deepEqual(sent, ["You have low hitpoints!", "You have low hitpoints!"], "again after recovering");

sent.length = 0;
config.setConfigValue(IdleNotifierConfig, "getPrayerNotification", true);
config.setConfigValue(IdleNotifierConfig, "getPrayerThreshold", 5);
tick();
state.prayer = 4;
tick();
assert.deepEqual(sent, ["You have low prayer!"]);

sent.length = 0;
config.setConfigValue(IdleNotifierConfig, "getLowEnergyNotification", true);
config.setConfigValue(IdleNotifierConfig, "getLowEnergyThreshold", 20);
config.setConfigValue(IdleNotifierConfig, "getHighEnergyNotification", true);
tick();
state.energy = 1900;
tick();
assert.deepEqual(sent, ["You have low run energy!"]);
state.energy = 10000;
tick();
assert.deepEqual(sent, ["You have low run energy!", "You have restored run energy!"]);

sent.length = 0;
config.setConfigValue(IdleNotifierConfig, "getSpecNotification", true);
config.setConfigValue(IdleNotifierConfig, "getSpecEnergyThreshold", 100);
state.spec = 900;
tick();
state.spec = 1000;
tick();
assert.deepEqual(sent, ["You have restored spec energy!"], "regen to the threshold");
state.spec = 0;
tick();
state.spec = 1000;
tick();
assert.equal(sent.length, 1, "a jump (a restore potion) doesn't count");

// Logging out resets the timers.
sent.length = 0;
state.animation = AnimationID.HUMAN_WOODCUTTING_RUNE_AXE;
tick();
state.animation = -1;
plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
for (let i = 0; i < 20; i++) tick();
assert.ok(!sent.includes("You are now idle!"), "no idle after the login screen");
void plugin.stop();

// --- Injected typing (a paste, the mobile keyboard) counts as keyboard input (#1941 review) ----
{
    let ms = 0;
    const input = new InputManager();
    (input as any).nowMs = () => ms;
    const listeners = new Map<string, (e: Event) => void>();
    const paste = new ChatPastePlugin(input, {
        addEventListener: (type: string, fn: any) => void listeners.set(type, fn),
        removeEventListener: (type: string) => void listeners.delete(type),
    } as any);
    void paste.start();
    const pasteText = (text: string) => listeners.get("paste")!({
        clipboardData: { getData: () => text },
        target: { tagName: "CANVAS" },
        preventDefault: () => {},
    } as unknown as Event);
    const adapter = new ClientImpl({ inputManager: input } as any);
    ms = 500;
    pasteText("hello");
    assert.equal(adapter.getKeyboardIdleTicks(), 0, "a paste resets keyboard idle");
    ms = 1000;
    input.enqueueTypedChar("a".charCodeAt(0));
    assert.equal(adapter.getKeyboardIdleTicks(), 0, "mobile keyboard text too");
    ms = 1500;
    input.enqueueOsrsKeyPress(84, "Enter");
    assert.equal(adapter.getKeyboardIdleTicks(), 0, "and injected Enter/Backspace");
    ms = 1700;
    assert.equal(adapter.getKeyboardIdleTicks(), 10, "200 ms later: 10 client ticks");

    // Idle Notifier's gate: while text is being pasted, no idle notification.
    const pasted: string[] = [];
    const typingClient = { ...client, getKeyboardIdleTicks: () => adapter.getKeyboardIdleTicks() } as Client;
    const typing = new IdleNotifierPlugin(typingClient, { notify: (m) => pasted.push(m) });
    typing.now = () => clock;
    void typing.start();
    const typingTick = (busy: boolean) => {
        clock += 600;
        ms += 600;
        if (busy) pasteText("gz");
        typing.onGameTick();
    };
    state.animation = AnimationID.HUMAN_WOODCUTTING_RUNE_AXE;
    typingTick(false);
    state.animation = -1;
    for (let i = 0; i < 20; i++) typingTick(true);
    assert.deepEqual(pasted, [], "pasting every tick keeps you active");
    state.animation = AnimationID.HUMAN_WOODCUTTING_RUNE_AXE;
    typingTick(false);
    state.animation = -1;
    for (let i = 0; i < 20; i++) typingTick(false);
    assert.deepEqual(pasted, ["You are now idle!"], "and stopping lets it notify");
    void typing.stop();
    void paste.stop();
}

console.log("idle-notifier-plugin: ok");
