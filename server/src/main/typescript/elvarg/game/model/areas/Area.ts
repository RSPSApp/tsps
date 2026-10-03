import { Boundary } from '../../../game/model/Boundary';
import { Player } from '../../entity/impl/player/Player';
import { NPC } from '../../entity/impl/npc/NPC';
import { Mobile } from '../../entity/impl/Mobile';

export abstract class Area {
    private boundaries: Boundary[];
    private npcs: { [key: number]: NPC } = {};
    private players: { [key: number]: Player } = {};
    private playerBots: { [key: number]: any } = {};

    constructor(boundaries?: Boundary[]) {
        this.boundaries = boundaries;
    }

    enter(character: Mobile) {
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

    process(character: Mobile) {
        // By default, do nothing in process.
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
