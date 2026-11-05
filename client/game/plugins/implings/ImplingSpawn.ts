import type { ImplingType } from "./Impling";

export type ImplingSpawn = { readonly x: number; readonly y: number; readonly plane: number; readonly type: ImplingType };

const spawn = (x: number, y: number, type: ImplingType): ImplingSpawn => ({ x, y, plane: 0, type });

/** RuneLite's ImplingSpawn: the fixed impling spawn points in Puro-Puro (the RuneLite list, as is). */
export const IMPLING_SPAWNS: readonly ImplingSpawn[] = [
    spawn(2563, 4291, "BABY"),
    spawn(2563, 4348, "BABY"),
    spawn(2569, 4323, "BABY"),
    spawn(2571, 4305, "BABY"),
    spawn(2581, 4300, "BABY"),
    spawn(2596, 4296, "BABY"),
    spawn(2609, 4339, "BABY"),
    spawn(2610, 4304, "BABY"),
    spawn(2615, 4322, "BABY"),
    spawn(2620, 4291, "BABY"),
    spawn(2620, 4348, "BABY"),

    spawn(2564, 4321, "YOUNG"),
    spawn(2573, 4330, "YOUNG"),
    spawn(2574, 4321, "YOUNG"),
    spawn(2590, 4348, "YOUNG"),
    spawn(2592, 4291, "YOUNG"),
    spawn(2595, 4343, "YOUNG"),
    spawn(2612, 4327, "YOUNG"),
    spawn(2612, 4309, "YOUNG"),
    spawn(2619, 4322, "YOUNG"),
    spawn(2587, 4300, "YOUNG"),

    spawn(2568, 4296, "GOURMET"),
    spawn(2569, 4327, "GOURMET"),
    spawn(2574, 4311, "GOURMET"),
    spawn(2574, 4311, "GOURMET"),
    spawn(2585, 4296, "GOURMET"),
    spawn(2597, 4293, "GOURMET"),
    spawn(2609, 4317, "GOURMET"),
    spawn(2615, 4298, "GOURMET"),
    spawn(2618, 4321, "GOURMET"),

    spawn(2570, 4330, "EARTH"),
    spawn(2598, 4340, "EARTH"),
    spawn(2587, 4342, "EARTH"),
    spawn(2612, 4310, "EARTH"),
    spawn(2611, 4334, "EARTH"),

    spawn(2574, 4317, "ESSENCE"),
    spawn(2576, 4337, "ESSENCE"),
    spawn(2585, 4298, "ESSENCE"),
    spawn(2601, 4343, "ESSENCE"),
    spawn(2612, 4318, "ESSENCE"),

    spawn(2567, 4319, "ECLECTIC"),
    spawn(2591, 4340, "ECLECTIC"),
    spawn(2591, 4295, "ECLECTIC"),
    spawn(2615, 4326, "ECLECTIC"),
];
