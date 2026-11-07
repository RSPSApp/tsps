/*
 * Copyright (c) 2020, Trevor <https://github.com/TrevorMartz>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */

/** The fight a clue step can spawn (RuneLite's Enemy), by the clue tier and where the step is. */
export class Enemy {
    private constructor(private readonly text: string) {}

    getText(): string {
        return this.text;
    }

    /** Hard emote steps in the Wilderness. */
    static readonly DOUBLE_AGENT_65 = new Enemy("Double Agent level 65");
    /** Hard emote steps outside the Wilderness. */
    static readonly DOUBLE_AGENT_108 = new Enemy("Double Agent level 108");
    /** Master emote steps everywhere. */
    static readonly DOUBLE_AGENT_141 = new Enemy("Double Agent level 141");
    /** Hard coordinate steps in the Wilderness. */
    static readonly ZAMORAK_WIZARD = new Enemy("Zamorak Wizard");
    /** Hard coordinate steps outside the Wilderness. */
    static readonly SARADOMIN_WIZARD = new Enemy("Saradomin Wizard");
    /** Elite coordinate steps in most areas. */
    static readonly ARMADYLEAN_OR_BANDOSIAN_GUARD = new Enemy("Armadylean OR Bandosian Guard");
    /** Elite coordinate steps on the west side of the Isle of Souls. */
    static readonly ARMADYLEAN_GUARD = new Enemy("Armadylean Guard");
    /** Elite coordinate steps on the east side of the Isle of Souls. */
    static readonly BANDOSIAN_GUARD = new Enemy("Bandosian Guard");
    /** Master coordinate and hot-cold steps in single-way combat. */
    static readonly BRASSICAN_MAGE = new Enemy("Brassican Mage");
    /** Master coordinate and hot-cold steps in multi-way combat. */
    static readonly ANCIENT_WIZARDS = new Enemy("Ancient Wizard Trio");
    /** One master hot-cold step sits on the border of multi and single combat. */
    static readonly BRASSICAN_OR_WIZARDS = new Enemy("Brassican Mage OR Ancient Wizards");
}
