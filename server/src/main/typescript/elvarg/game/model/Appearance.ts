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
    /** The skin palette's length (client PLAYER_BODY_RECOLOR_TO_1[4]); the cache's red (13) isn't in it. */
    static readonly SKIN_COLOUR_COUNT = 13;
    /**
     * The skin colours behind a Halloween unlock, as the cache's [proc,makeover_unlockedcolour]
     * gates them (0-7 and 12 are open to everyone). Each unlock is a saved attribute, shown to the
     * client as its varbit. By the Wiki (Makeover) they need "a Halloween event ... completed since
     * release of the respective colour".
     */
    static readonly SKIN_UNLOCKS: ReadonlyArray<{ attribute: string; varbit: string; colours: readonly number[] }> = [
        { attribute: "appearance:hw07-skin-colours", varbit: "hw07_skincols", colours: [8] }, // green
        { attribute: "appearance:hw15-skin-colours", varbit: "hw15_skincols", colours: [9, 10] }, // black, white
        { attribute: "appearance:hw17-skin-colours", varbit: "hw17_skincols", colours: [11] }, // blue
    ];

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
            this.look[Appearance.BEARD] = -1;
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

    /** Whether this player may choose a skin colour; out-of-palette values never are. */
    isSkinColourUnlocked(colour: number): boolean {
        if (!Number.isInteger(colour) || colour < 0 || colour >= Appearance.SKIN_COLOUR_COUNT) return false;
        const unlock = Appearance.SKIN_UNLOCKS.find((entry) => entry.colours.includes(colour));
        return !unlock || this.player.getAttribute(unlock.attribute) === true;
    }

    /** The skin colours this player may choose, in palette order. */
    unlockedSkinColours(): number[] {
        return Array.from({ length: Appearance.SKIN_COLOUR_COUNT }, (_, colour) => colour)
            .filter((colour) => this.isSkinColourUnlocked(colour));
    }

    /**
     * The next skin colour from `current` in `direction` (1 or -1) through the palette, wrapping and
     * skipping colours not in `unlocked`. A locked or out-of-palette `current` steps off it, so a kept
     * locked colour moves to its neighbour, as in the browser designer (stepSkinColour).
     */
    static stepSkinColour(current: number, direction: number, unlocked: readonly number[]): number {
        const count = Appearance.SKIN_COLOUR_COUNT;
        const dir = direction < 0 ? -1 : 1;
        let colour = Number.isInteger(current) && current >= 0 && current < count ? current : dir === 1 ? -1 : count;
        for (let i = 0; i < count; i++) {
            colour = (colour + dir + count) % count;
            if (unlocked.includes(colour)) return colour;
        }
        return current;
    }

    isMale(): boolean {
        return this.look[Appearance.GENDER] == 0;
    }
}
