const Common = require("./Common.AdventurePaths");
// Cache241 scripts2945/2951: path enum2618, task enum2620 and struct params806/810/815/816/820/821.
const PATHS_ENUM = 2618,
    TASKS_ENUM = 2620;
let catalogue;
function reward(params, section) {
    const C = Common.core.CacheDefinitions,
        items = C.getEnumValues(params.get(820)).get(section),
        amounts = C.getEnumValues(params.get(821)).get(section);
    if (items == null || amounts == null) return [];
    return [...C.getEnumValues(items).values()].map((id) => ({
        id,
        amount: C.getEnumValues(amounts).get(id),
    }));
}
function paths() {
    if (catalogue) return catalogue;
    const C = Common.core.CacheDefinitions;
    catalogue = [...C.getEnumValues(PATHS_ENUM)]
        .filter(([id]) => id < 2)
        .map(([id, struct]) => {
            const params = C.getStructParams(struct);
            const tasks = [...C.getEnumValues(C.getEnumValues(TASKS_ENUM).get(id))].map(
                ([index, struct]) => {
                    const p = C.getStructParams(struct);
                    return {
                        id: p.get(806),
                        index,
                        struct,
                        path: id,
                        name: p.get(810),
                        skill: p.get(815),
                        level: p.get(816),
                        free: reward(p, 0),
                        members: reward(p, 1),
                    };
                },
            );
            return { id, struct, name: params.get(828), tasks, reward: reward(params, 2) };
        });
    return catalogue;
}
const tasks = () => paths().flatMap((p) => p.tasks);
// Wiki Combat_path_voucher: actual grants differ from the native descriptive quantities.
function vouchers() {
    const C = Common.core.CacheDefinitions,
        I = Common.core.ItemIdentifiers;
    const prizes = {
        0: [[I.COINS, 2500]],
        1: [[I.IRON_ARROW, 100]],
        2: [
            [I.MIND_RUNE, 200],
            [I.AIR_RUNE, 200],
        ],
        3: [[I.ENERGY_POTION_3_, 5]],
        4: [
            [I.MITHRIL_PLATEBODY, 1],
            [I.STUDDED_BODY, 1],
        ],
        5: [[I.ADAMANT_SHORTSWORD, 1]],
        6: [
            [I.MAPLE_SHORTBOW, 1],
            [I.IRON_ARROW, 100],
        ],
        7: [[I.CHAOS_RUNE, 50]],
        8: [[I.ENERGY_POTION_4_, 5]],
    };
    return [...C.getEnumValues(C.getEnumValues(2621).get(0)).values()].map((struct) => {
        const p = C.getStructParams(struct),
            npcId = p.get(837),
            ids = new Set([npcId, ...(C.getNpc(npcId).transforms ?? []).filter((n) => n > 0)]);
        if (npcId === C.getNpcId("ge_clerk_1"))
            for (const name of ["ge_clerk_2", "ge_clerk_3", "ge_clerk_4"])
                ids.add(C.getNpcId(name));
        if (npcId === C.getNpcId("swordshop1")) ids.add(C.getNpcId("swordshop2"));
        return {
            struct,
            ids,
            free: p.has(844)
                ? {
                      key: p.get(844),
                      items: prizes[p.get(844)]?.map(([id, amount]) => ({ id, amount })),
                  }
                : null,
            members: p.has(845)
                ? {
                      key: p.get(845),
                      items: prizes[p.get(845)]?.map(([id, amount]) => ({ id, amount })),
                  }
                : null,
        };
    });
}
module.exports = { paths, tasks, vouchers };
