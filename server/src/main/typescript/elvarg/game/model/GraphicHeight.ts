export enum GraphicHeight {
    LOW = 0,
    MIDDLE = 50,
    HIGH = 100,
    /** Captured heights (Royal Titans rsprox): Fire/Water Surge cast 92, impact 124;
     * 92 also observed on the standard teleport casting swirl (111). */
    SURGE_CAST = 92,
    SURGE_IMPACT = 124,
    /** Captured on nearly every spell impact and splash (rsprox revs 234-241: failedspell_impact 85 at 124 in
     * 20,968 of 21,082 sends, firewave_impact 157 in 1,281 of 1,837; the rest are per-target heights). */
    SPELL_IMPACT = 124,
    /** Captured on every archer's arrow-draw spotanim (rsprox 1579, 4101, 470-476, ...). */
    ARCHER_DRAW = 96,
}
