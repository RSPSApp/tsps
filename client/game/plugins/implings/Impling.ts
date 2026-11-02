import * as NpcID from "@runelite/api/gameval/NpcID";

/** RuneLite's ImplingType: each kind of impling and the name the notification uses. */
export const ImplingType = {
    BABY: "Baby",
    YOUNG: "Young",
    GOURMET: "Gourmet",
    EARTH: "Earth",
    ESSENCE: "Essence",
    ECLECTIC: "Eclectic",
    NATURE: "Nature",
    MAGPIE: "Magpie",
    NINJA: "Ninja",
    CRYSTAL: "Crystal",
    DRAGON: "Dragon",
    LUCKY: "Lucky",
} as const;

export type ImplingType = keyof typeof ImplingType;

export const IMPLING_TYPES = Object.keys(ImplingType) as ImplingType[];

export function implingTypeName(type: ImplingType): string {
    return ImplingType[type];
}

export type Impling = { readonly type: ImplingType; readonly npcId: number };

/** RuneLite's Impling enum: every impling NPC id (the overworld one and Puro-Puro's) and its type. */
export const IMPLINGS: readonly Impling[] = [
    { type: "BABY", npcId: NpcID.II_IMPLING_TYPE_1 },
    { type: "BABY", npcId: NpcID.II_IMPLING_TYPE_1_MAZE },
    { type: "YOUNG", npcId: NpcID.II_IMPLING_TYPE_2 },
    { type: "YOUNG", npcId: NpcID.II_IMPLING_TYPE_2_MAZE },
    { type: "GOURMET", npcId: NpcID.II_IMPLING_TYPE_3 },
    { type: "GOURMET", npcId: NpcID.II_IMPLING_TYPE_3_MAZE },
    { type: "EARTH", npcId: NpcID.II_IMPLING_TYPE_4 },
    { type: "EARTH", npcId: NpcID.II_IMPLING_TYPE_4_MAZE },
    { type: "ESSENCE", npcId: NpcID.II_IMPLING_TYPE_5 },
    { type: "ESSENCE", npcId: NpcID.II_IMPLING_TYPE_5_MAZE },
    { type: "ECLECTIC", npcId: NpcID.II_IMPLING_TYPE_6 },
    { type: "ECLECTIC", npcId: NpcID.II_IMPLING_TYPE_6_MAZE },
    { type: "NATURE", npcId: NpcID.II_IMPLING_TYPE_7 },
    { type: "NATURE", npcId: NpcID.II_IMPLING_TYPE_7_MAZE },
    { type: "MAGPIE", npcId: NpcID.II_IMPLING_TYPE_8 },
    { type: "MAGPIE", npcId: NpcID.II_IMPLING_TYPE_8_MAZE },
    { type: "NINJA", npcId: NpcID.II_IMPLING_TYPE_9 },
    { type: "NINJA", npcId: NpcID.II_IMPLING_TYPE_9_MAZE },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_JOHNNY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_JUNIOR },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_ANDY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_JOEY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_TROUBLE },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_HINGY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_ZOLTY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_NEIL },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_YANNY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_MATTY },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_STACE },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_IAN },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_JAMIE },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_DAMO },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_XANDER },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_STEVEO },
    { type: "CRYSTAL", npcId: NpcID.II_IMPLING_TYPE_12_STEWIE },
    { type: "DRAGON", npcId: NpcID.II_IMPLING_TYPE_10 },
    { type: "DRAGON", npcId: NpcID.II_IMPLING_TYPE_10_MAZE },
    { type: "LUCKY", npcId: NpcID.II_IMPLING_TYPE_11 },
    { type: "LUCKY", npcId: NpcID.II_IMPLING_TYPE_11_MAZE },
];

const BY_NPC_ID = new Map<number, Impling>(IMPLINGS.map((impling) => [impling.npcId, impling]));

/** RuneLite's Impling.findImpling: the impling an NPC id is, or undefined. */
export function findImpling(npcId: number): Impling | undefined {
    return BY_NPC_ID.get(npcId | 0);
}
