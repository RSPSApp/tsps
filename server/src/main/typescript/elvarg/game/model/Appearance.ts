import { Player } from "../entity/impl/player/Player";
import { Flag } from "./Flag";
export class Appearance {
    static readonly HAIR_COLOUR = 8;
    static readonly TORSO_COLOUR = 9;
    static readonly LEG_COLOUR = 10;
    static readonly FEET_COLOUR = 11;
    static readonly SKIN_COLOUR = 12;
    static readonly HEAD = 1;
    static readonly CHEST = 2;
    static readonly ARMS = 3;
    static readonly HANDS = 4;
    static readonly LEGS = 5;
    static readonly FEET = 6;
    static readonly BEARD = 7;
    static readonly GENDER = 0;
    static readonly PRONOUNS_ATTRIBUTE = "appearance:pronouns";

    canChangeAppearance = false;
    headHint = -1;
    // Match Java int[13] semantics: all slots start at 0.
    look: number[] = new Array(13).fill(0);
    player: Player;

    constructor(player: Player) {
        this.player = player;
        this.set();
    }
    getHeadHint(): number {
        return this.headHint;
    }

    setHeadHint(headHint: number): this {
        this.headHint = headHint;
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
        return this;
    }

    getCanChangeAppearance(): boolean {
        return this.canChangeAppearance;
    }

    setCanChangeAppearance(l: boolean): void {
        this.canChangeAppearance = l;
    }

    getLook(): number[] {
        return this.look;
    }

    setLookArray(look: number[]): void {
        if (look.length < 12) {
            throw new Error("Array length must be 12.");
        }
        this.look = look;
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    setLook(index: number, look: number): void {
        this.look[index] = look;
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    set() {
        if (this.isMale()) {
            this.look[Appearance.HEAD] = 3;
            this.look[Appearance.CHEST] = 18;
            this.look[Appearance.ARMS] = 26;
            this.look[Appearance.HANDS] = 34;
            this.look[Appearance.LEGS] = 38;
            this.look[Appearance.FEET] = 42;
            this.look[Appearance.BEARD] = 14;
        } else {
            this.look[Appearance.HEAD] = 48;
            this.look[Appearance.CHEST] = 57;
            this.look[Appearance.ARMS] = 65;
            this.look[Appearance.HANDS] = 68;
            this.look[Appearance.LEGS] = 77;
            this.look[Appearance.FEET] = 80;
            this.look[Appearance.BEARD] = 57;
        }
        this.look[Appearance.HAIR_COLOUR] = 2;
        this.look[Appearance.TORSO_COLOUR] = 14;
        this.look[Appearance.LEG_COLOUR] = 5;
        this.look[Appearance.FEET_COLOUR] = 4;
        this.look[Appearance.SKIN_COLOUR] = 0;
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    getPronouns(): number {
        const value = this.player.getAttribute(Appearance.PRONOUNS_ATTRIBUTE);
        return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2 ? value : this.isMale() ? 0 : 1;
    }

    setPronouns(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 2) return;
        this.player.setAttribute(Appearance.PRONOUNS_ATTRIBUTE, value);
        this.player.getUpdateFlag().flag(Flag.APPEARANCE);
    }

    isMale(): boolean {
        return this.look[Appearance.GENDER] == 0;
    }
}
