import type { Actor, Client, NPC, NPCComposition, Player, WorldPoint } from "@runelite/api/Client";
import type { GameState } from "@runelite/api/GameState";
import { TOPLEVEL } from "@runelite/api/gameval/InterfaceID";
import type { OsrsClient } from "../../game/OsrsClient";
import { getCurrentTick } from "../../network/serverConnection/timing";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import type { SkillId } from "../../rs/skill/skills";
import { toRuneLiteGameState } from "./GameStateMapping";

/** RuneLite's Constants.CLIENT_TICK_LENGTH. */
const CLIENT_TICK_LENGTH = 20;

/** The RuneLite `Client` facade over our engine. */
export class ClientImpl implements Client {
    constructor(private readonly osrsClient: OsrsClient) {}

    getGameState(): GameState {
        return toRuneLiteGameState(this.osrsClient.gameState);
    }

    getLocalPlayer(): Player | null {
        const client = this.osrsClient;
        const index = client.playerEcs?.getIndexForServerId(client.controlledPlayerServerId);
        if (client.controlledPlayerServerId < 0 || index === undefined || index < 0) return null;
        const players = client.playerEcs;
        return {
            getName: () => client.localPlayerName,
            getCombatLevel: () => players.getCombatLevel(index),
            getAnimation: () => {
                const seq = players.getAnimActionSeqId(index) | 0;
                return seq >= 0 ? seq : -1;
            },
            // The player ECS holds world positions, 128 units per tile.
            getWorldLocation: (): WorldPoint => ({
                x: players.getX(index) >> 7,
                y: players.getY(index) >> 7,
                plane: players.getLevel(index) | 0,
            }),
            getInteracting: () => this.actor(players.getInteractionIndex(index)),
        };
    }

    /** The NPC or player behind an encoded interaction index. */
    private actor(key: number): Actor | null {
        const target = decodeInteractionIndex(key);
        if (!target) return null;
        const client = this.osrsClient;
        if (target.type === "player") {
            const index = client.playerEcs?.getIndexForServerId(target.id);
            return {
                getName: () => (index === undefined ? null : client.playerEcs.getName(index) ?? null),
                getInteractionKey: () => key,
            };
        }
        const npc: NPC = {
            getId: () => this.npcType(target.id)?.id ?? -1,
            getIndex: () => target.id,
            getName: () => this.npcType(target.id)?.name ?? null,
            getInteractionKey: () => key,
            getComposition: (): NPCComposition | null => {
                const type = this.npcType(target.id);
                return type ? { getName: () => type.name, getActions: () => type.actions ?? [] } : null;
            },
        };
        return npc;
    }

    /** The NPC's type after transforms (RuneLite's NPC.getTransformedComposition). */
    private npcType(serverId: number): { id: number; name: string; actions: string[] } | undefined {
        const client = this.osrsClient;
        const ecsId = client.npcEcs?.getEcsIdForServer(serverId);
        if (ecsId === undefined) return undefined;
        let type = client.npcTypeLoader?.load(client.npcEcs.getNpcTypeId(ecsId) | 0);
        if (type?.transforms) type = type.transform(client.varManager, client.npcTypeLoader) ?? type;
        return type ?? undefined;
    }

    getVarpValue(varpId: number): number {
        return this.osrsClient.varManager?.getVarp(varpId) ?? 0;
    }

    getVarbitValue(varbitId: number): number {
        return this.osrsClient.varManager?.getVarbit(varbitId) ?? 0;
    }

    getRealSkillLevel(skill: SkillId): number {
        return this.osrsClient.cs2Vm?.context?.getStatBase?.(skill) ?? 1;
    }

    getBoostedSkillLevel(skill: SkillId): number {
        return this.osrsClient.cs2Vm?.context?.getStatBoosted?.(skill) ?? 1;
    }

    isResized(): boolean {
        const root = this.osrsClient.widgetManager?.rootInterface;
        return root !== undefined && root !== TOPLEVEL;
    }

    getEnergy(): number {
        return this.osrsClient.cs2Vm?.context?.getRunEnergy?.() ?? 0;
    }

    getTickCount(): number {
        return getCurrentTick();
    }

    getMouseLastPressedMillis(): number {
        return this.osrsClient.inputManager?.clickTime ?? 0;
    }

    getKeyboardIdleTicks(): number {
        const input = this.osrsClient.inputManager;
        return input ? Math.floor(input.getKeyboardIdleMs() / CLIENT_TICK_LENGTH) : 0;
    }

    /**
     * Throws when the script can't run: before the cache is loaded, or while another script runs
     * (a top-level run would reset that script's stacks). RuneLite runs scripts only on the
     * client thread, between scripts, so it never meets the second case.
     */
    runScript(scriptId: number, ...args: number[]): void {
        const vm = this.osrsClient.cs2Vm;
        if (!vm || vm.isRunning()) throw new Error(`Client script ${scriptId} can't run now`);
        const script = vm.context?.loadScript?.(scriptId | 0);
        if (!script) throw new Error(`Client script ${scriptId} is not in the cache`);
        vm.run(script, args, []);
    }

    getIntStack(): ArrayLike<number> {
        return this.osrsClient.cs2Vm.intStack;
    }
}
