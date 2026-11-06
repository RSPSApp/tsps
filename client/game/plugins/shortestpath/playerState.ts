import { QP } from "@runelite/api/gameval/VarPlayerID";
import type { OsrsClient } from "../../OsrsClient";
import type { PlayerSnapshot, QuestState } from "./requirement/Requirements";
import { COMBAT_LEVEL_INDEX, QUEST_POINTS_INDEX, SKILL_LEVELS_LENGTH, SKILL_NAMES, TOTAL_LEVEL_INDEX } from "./transport/Transport";

/** ScriptID.QUEST_STATUS_GET: returns 2 finished, 1 not started, anything else in progress. */
const QUEST_STATUS_GET = 4029;

type Slots = { getSlots?(): { itemId: number; quantity: number }[] } | undefined;

function addSlots(into: Map<number, number>, inventory: Slots): number {
    let count = 0;
    for (const slot of inventory?.getSlots?.() ?? []) {
        if (slot.itemId < 0 || slot.quantity <= 0) continue;
        into.set(slot.itemId, (into.get(slot.itemId) ?? 0) + slot.quantity);
        count++;
    }
    return count;
}

/** PlayerStateSource.computeCombatLevel. */
export function computeCombatLevel(attack: number, strength: number, defence: number, hitpoints: number, magic: number,
    ranged: number, prayer: number): number {
    const base = 0.25 * (defence + hitpoints + Math.floor(prayer / 2));
    const melee = (13 * (attack + strength)) / 40;
    const range = (13 * (3 * Math.floor(ranged / 2))) / 40;
    const mage = (13 * (3 * Math.floor(magic / 2))) / 40;
    return Math.floor(base + Math.max(melee, range, mage));
}

/**
 * RuneLite's Quest.getState: runs QUEST_STATUS_GET on the client's script VM. A VM that is busy
 * (a quest asked from inside a script) or missing reads as not started.
 */
export function questStateReader(client: OsrsClient): (questId: number) => QuestState {
    const cache = new Map<number, QuestState>();
    return (questId) => {
        const cached = cache.get(questId);
        if (cached) return cached;
        const vm: any = (client as any).cs2Vm;
        let state: QuestState = "NOT_STARTED";
        const script = vm && !vm.isRunning?.() ? vm.context?.loadScript?.(QUEST_STATUS_GET) : null;
        if (script) {
            try {
                vm.run(script, [questId], []);
                const value = vm.intStackSize > 0 ? vm.intStack[0] | 0 : 1;
                state = value === 2 ? "FINISHED" : value === 1 ? "NOT_STARTED" : "IN_PROGRESS";
            } catch (error) {
                console.warn(`[shortest-path] quest ${questId} state unknown`, error);
            }
        }
        cache.set(questId, state);
        return state;
    };
}

/** Upstream's RequirementContext.capture: the player's levels, quests, vars and items, once per refresh. */
export function capturePlayer(client: OsrsClient, bankSeen: boolean): PlayerSnapshot {
    const anyClient = client as any;
    const skills: Map<number, { currentLevel: number; baseLevel: number }> | undefined = anyClient.skillsMap;
    const levels = new Array<number>(SKILL_LEVELS_LENGTH).fill(0);
    const real = (skill: number) => skills?.get(skill)?.baseLevel ?? 1;
    let total = 0;
    for (let skill = 0; skill < SKILL_NAMES.length; skill++) {
        levels[skill] = skills?.get(skill)?.currentLevel ?? real(skill);
        total += real(skill);
    }
    levels[TOTAL_LEVEL_INDEX] = total;
    levels[COMBAT_LEVEL_INDEX] = computeCombatLevel(real(0), real(2), real(1), real(3), real(6), real(4), real(5));
    const vars = client.varManager;
    levels[QUEST_POINTS_INDEX] = vars?.getVarp(QP) ?? 0;

    const carried = new Map<number, number>();
    addSlots(carried, client.inventory);
    addSlots(carried, client.equipment);
    const bank = new Map<number, number>();
    const bankItems = addSlots(bank, client.lastKnownBank);
    return {
        levels,
        questState: questStateReader(client),
        varbit: (id) => vars?.getVarbit(id) ?? 0,
        varp: (id) => vars?.getVarp(id) ?? 0,
        carried,
        bank: bankSeen || bankItems > 0 ? bank : null,
        currentTimeMinutes: Math.floor(Date.now() / 60000),
    };
}
