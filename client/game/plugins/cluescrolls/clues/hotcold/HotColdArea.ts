/*
 * Copyright (c) 2018, Adam <Adam@sigterm.info>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */

/** The regions hot-cold dig spots are grouped under in the panel (RuneLite's HotColdArea). */
export class HotColdArea {
    private constructor(private readonly name: string) {}

    getName(): string {
        return this.name;
    }

    static readonly ASGARNIA = new HotColdArea("Asgarnia");
    static readonly DESERT = new HotColdArea("Desert");
    static readonly FELDIP_HILLS = new HotColdArea("Feldip Hills");
    static readonly FREMENNIK_PROVINCE = new HotColdArea("Fremennik Province");
    static readonly KANDARIN = new HotColdArea("Kandarin");
    static readonly KARAMJA = new HotColdArea("Karamja");
    static readonly MISTHALIN = new HotColdArea("Misthalin");
    static readonly MORYTANIA = new HotColdArea("Morytania");
    static readonly OCEAN = new HotColdArea("Ocean");
    static readonly VARLAMORE = new HotColdArea("Varlamore");
    static readonly WESTERN_PROVINCE = new HotColdArea("Western Province");
    static readonly WILDERNESS = new HotColdArea("Wilderness");
    static readonly ZEAH = new HotColdArea("Zeah");
}
