import { Boundary } from '../../../game/model/Boundary';
import { Player } from '../../entity/impl/player/Player';
import { NPC } from '../../entity/impl/npc/NPC';
import { Mobile } from '../../entity/impl/Mobile';
import { PluginManager } from '../../../plugins/PluginManager';

export abstract class Area {
    private boundaries: Boundary[];
    private npcs: { [key: number]: NPC } = {};
    private players: { [key: number]: Player } = {};
    private playerBots: { [key: number]: any } = {};
    /** Set by api.registerArea; pluginperf reports this area's methods under it. */
    public pluginName: string | null = null;

    constructor(boundaries?: Boundary[]) {
        this.boundaries = boundaries;
    }

    enter(character: Mobile) {
        // Code that moves an actor straight into another area (an instance claiming a player
        // mid-teleport) bypasses AreaManager, so the area it was in would never hear it left.
        const previous = character.getArea();
        if (previous && previous !== this && previous.hasMember(character)) {
            PluginManager.callArea(previous, "leave", character, false);
        }
        // bots disabled in this runtime

        if (character.isPlayer()) {
            this.players[character.getIndex()] = (character.getAsPlayer() as unknown) as Player;
        } else if (character.isNpc()) {
            this.npcs[character.getIndex()] = character.getAsNpc();
        }
        this.postEnter(character);
    }

    postEnter(character: Mobile) { }

    leave(character: Mobile, logout: boolean) {
        // bots disabled in this runtime

        if (character.isPlayer()) {
            delete this.players[character.getIndex()];
        } else if (character.isNpc()) {
            delete this.npcs[character.getIndex()];
        }
        this.postLeave(character, logout);
    }

    postLeave(character: Mobile, logout: boolean) { }

    /** Whether `character` entered this area and has not left it. */
    hasMember(character: Mobile): boolean {
        if (character.isPlayer()) {
            return this.players[character.getIndex()] === (character as unknown);
        }
        return character.isNpc() && this.npcs[character.getIndex()] === (character as unknown);
    }

    process(character: Mobile) {
        // By default, do nothing in process.
    }

    // Rule hooks for actors standing in this area. Core asks the area before the global
    // plugin hooks, so a rule that only applies here costs nothing for anyone elsewhere.
    // null means "no opinion" and falls through to the plugin hooks.

    /** Asked of the attacker's area, then the target's. */
    canAttack(attacker: Mobile, target: Mobile, method?: any): boolean | null {
        return null;
    }

    /** Explicitly allows or refuses spell targeting, including non-combat puzzle NPCs. */
    canCastOnNpc(player: Player, npc: NPC, spell: any): boolean | null {
        return null;
    }

    canTeleport(player: Player, wildernessLevelLimit: number, destination?: any): boolean | null {
        return null;
    }

    /**
     * A walk click the engine would refuse because the player is mid forced move (or being placed
     * after one): true when the area takes it (a roll chained at once), false to refuse it.
     */
    handleForcedWalk(player: Player, destination: { x: number; y: number; z: number }): boolean {
        return false;
    }

    /** true keeps `npc` aggressive towards `player` despite their tolerance timer. */
    npcAggressionTolerance(player: Player, npc: NPC): boolean | null {
        return null;
    }

    /**
     * Whether an aggressive `npc` starts a fight with `player`: false never (wearing its god's
     * item in the God Wars Dungeon), true always (even if not aggressive elsewhere, past its
     * combat-level and tolerance checks).
     */
    npcAggression(player: Player, npc: NPC): boolean | null {
        return null;
    }

    /** Whether this area is a multi-combat zone. Areas outside the Wilderness opt in here. */
    public isMulti(): boolean {
        return false;
    }

    public getBoundaries(): Boundary[] {
        return this.boundaries;
    }

    public getName(): string {
        return this.constructor.name;
    }

    public getNpcs(): NPC[] {
        return Object.values(this.npcs);
    }

    public getPlayers(): Player[] {
        return Object.values(this.players);
    }

    public getPlayerBots(): any[] {
        return Object.values(this.playerBots);
    }
}
