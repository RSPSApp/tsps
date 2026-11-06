/** RuneLite's EquipmentInventorySlot: the slot index of each worn-equipment position. */
export const EquipmentInventorySlot = {
    HEAD: 0,
    CAPE: 1,
    AMULET: 2,
    WEAPON: 3,
    BODY: 4,
    SHIELD: 5,
    LEGS: 7,
    GLOVES: 9,
    BOOTS: 10,
    RING: 12,
    AMMO: 13,
} as const;

export type EquipmentInventorySlot = (typeof EquipmentInventorySlot)[keyof typeof EquipmentInventorySlot];
