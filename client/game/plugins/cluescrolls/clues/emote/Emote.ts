/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */

/**
 * The emotes clue steps ask for (RuneLite's Emote): the emote tab's name for each and its sprite
 * (RuneLite's SpriteID.Emotes.*, the cache's emote sprites 700-739 and later additions).
 */
export class Emote {
    private constructor(
        private readonly name: string,
        private readonly spriteId: number,
    ) {}

    getName(): string {
        return this.name;
    }

    getSpriteId(): number {
        return this.spriteId;
    }

    hasSprite(): boolean {
        return this.spriteId !== -1;
    }

    static readonly BULL_ROARER = new Emote("Bull Roarer", -1);
    static readonly YES = new Emote("Yes", 700);
    static readonly NO = new Emote("No", 701);
    static readonly THINK = new Emote("Think", 702);
    static readonly BOW = new Emote("Bow", 703);
    static readonly ANGRY = new Emote("Angry", 704);
    static readonly CRY = new Emote("Cry", 705);
    static readonly LAUGH = new Emote("Laugh", 706);
    static readonly CHEER = new Emote("Cheer", 707);
    static readonly WAVE = new Emote("Wave", 708);
    static readonly BECKON = new Emote("Beckon", 709);
    static readonly DANCE = new Emote("Dance", 710);
    static readonly CLAP = new Emote("Clap", 711);
    static readonly PANIC = new Emote("Panic", 712);
    static readonly JIG = new Emote("Jig", 713);
    static readonly SPIN = new Emote("Spin", 714);
    static readonly HEADBANG = new Emote("Headbang", 715);
    static readonly JUMP_FOR_JOY = new Emote("Jump for Joy", 716);
    static readonly RASPBERRY = new Emote("Raspberry", 717);
    static readonly YAWN = new Emote("Yawn", 718);
    static readonly SALUTE = new Emote("Salute", 719);
    static readonly SHRUG = new Emote("Shrug", 720);
    static readonly BLOW_KISS = new Emote("Blow Kiss", 721);
    static readonly GOBLIN_SALUTE = new Emote("Goblin Salute", 727);
    static readonly SLAP_HEAD = new Emote("Slap Head", 729);
    static readonly STAMP = new Emote("Stamp", 730);
    static readonly FLAP = new Emote("Flap", 731);
    /** SpriteID.Emotes._42. */
    static readonly PUSH_UP = new Emote("Push up", 1204);
    /** SpriteID.Emotes._56. */
    static readonly CRAB_DANCE = new Emote("Crab Dance", 5245);
}
