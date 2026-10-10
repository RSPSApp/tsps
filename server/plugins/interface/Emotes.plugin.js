const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Graphic } = require("../../src/main/typescript/elvarg/game/model/Graphic");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");

const EMOTE_CONTENTS_UID = (216 << 16) | 2;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const LAST_EMOTE_SLOT = 55;
const EMOTE_ACTION_FLAGS = (1 << 1) | (1 << 2);

const EMOTES = [
    { sequence: 855, loop: 189 },
    { sequence: 856, loop: 190 },
    { sequence: 858, loop: 192 },
    { sequence: 859, loop: 193 },
    { sequence: 857, loop: 191 },
    { sequence: 863, loop: 197 },
    { sequence: 2113, loop: 12056 },
    { sequence: 862, loop: 196 },
    { sequence: 864, loop: 2691 },
    { sequence: 861, loop: 195 },
    { sequence: 2109, loop: 12051 },
    { sequence: 2111, loop: 12053 },
    { sequence: 866, loop: 10048 },
    { sequence: 2106, loop: 10049 },
    { sequence: 2107, loop: 12085 },
    { sequence: 2108, loop: 10050 },
    { sequence: 860, loop: 194 },
    { sequence: 1374, loop: 3803 },
    { sequence: 2105, loop: 12050 },
    { sequence: 2110, loop: 12052 },
    { sequence: 865, loop: 3193 },
    { sequence: 2112, loop: 12055 },
    { sequence: 2127, loop: 12082 },
    { sequence: 2128, loop: 12074 },
    { sequence: 1131, loop: 12068 },
    { sequence: 1130, loop: 12067 },
    { sequence: 1129, loop: 10062 },
    { sequence: 1128, loop: 12066 },
    { sequence: 4276, loop: 12072 },
    { sequence: 4278, loop: 12080 },
    { sequence: 4280, loop: 12073 },
    { sequence: 4275, loop: 12071 },
    { sequence: 3544, loop: 12070 },
    { sequence: 3543, loop: 12069 },
    { sequence: 2836, loop: 12075 },
    { sequence: 6111, loop: 12057 },
    { sequence: 874, loop: 12061 },
    { sequence: 872, loop: 12060 },
    { sequence: 870, loop: 12059 },
    { sequence: 868, loop: 12058 },
    { sequence: 8917, loop: 12064 },
    { sequence: 1708 },
    { sequence: 7131, loop: 12062 },
    { skillcape: true },
    { airGuitar: true },
    { sequence: 7278 },
    { sequence: 7533 },
    { variants: [7536, 7537] },
    { sequence: 7751 },
    { sequence: 8541, loop: 12063 },
    { sequence: 9208 },
    { sequence: 10031, loop: 12065 },
    { sequence: 10503 },
    { sequence: 10796, loop: 10797 },
    { sequence: 10053, loop: 10061, loopFirst: true },
    { sequence: 10051, loop: 10052, loopFirst: true },
];

const SKILLCAPE_ROWS = [
    [[9747, 9748], 4959, 823],
    [[9750, 9751], 4981, 828],
    [[9753, 9754], 4961, 824],
    [[9756, 9757], 4973, 832],
    [[9759, 9760], 4979, 829],
    [[9762, 9763], 4939, 813],
    [[9765, 9766], 4947, 817],
    [[9768, 9769], 4971, 833],
    [[9771, 9772], 4977, 830],
    [[9774, 9775], 4969, 835],
    [[9777, 9778], 4965, 826],
    [[9780, 9781], 4949, 818],
    [[9783, 9784], 4937, 812],
    [[9786, 9787], 4967, 827],
    [[9789, 9790], 4953, 820],
    [[9792, 9793], 4941, 814],
    [[9795, 9796], 4943, 815],
    [[9798, 9799], 4951, 819],
    [[9801, 9802], 4955, 821],
    [[9804, 9805], 4975, 831],
    [[9807, 9808], 4957, 822],
    [[9810, 9811], 4963, 825],
    [[9948, 9949], 5158, 907],
    [[13069, 19476], 2709],
    [[13221, 13222, 14204, 14205], 4751],
    [[13280, 13342, 13329, 21186, 13331, 13333, 13335, 13337, 20760, 21284,
        21285, 24133, 21776, 24232, 21780, 24233, 21784, 24234, 21898, 24135,
        24134, 24855, 27363, 27365, 28902, 28906], 7121, 1286],
];

const SKILLCAPE_EMOTES = new Map();
for (const [itemIds, sequence, graphic] of SKILLCAPE_ROWS) {
    for (const itemId of itemIds) {
        SKILLCAPE_EMOTES.set(itemId, { sequence, graphic });
    }
}

const variantIndices = new WeakMap();

function enableEmoteActions(player) {
    player.getPacketSender().sendInterfaceFlagsRange(
        EMOTE_CONTENTS_UID,
        0,
        LAST_EMOTE_SLOT,
        EMOTE_ACTION_FLAGS,
    );
}

function questCapeReady(player, api) {
    const request = { player, canUse: false };
    api.emitCustomEvent("quest-cape:can-use", request);
    return request.canUse === true;
}

function resolveSkillcapeEmote(player, api) {
    const cape = player.getEquipment().getItems()[Equipment.CAPE_SLOT];
    if (!cape) return undefined;
    const items = api.core.ItemIdentifiers;
    if (cape.getId() === items.QUEST_POINT_CAPE || cape.getId() === items.QUEST_POINT_CAPE_T_) {
        return questCapeReady(player, api) ? { sequence: 4945, graphic: 816 } : undefined;
    }
    if ([items.MUSIC_CAPE, items.MUSIC_CAPE_T_, items.MUSIC_CAPE_2, items.MUSIC_CAPE_T__2].includes(cape.getId())) {
        const request = { player, unlocked: false };
        api.emitCustomEvent("music:air-guitar-unlocked", request);
        return request.unlocked === true ? { sequence: 4751, graphic: 1239 } : undefined;
    }
    return SKILLCAPE_EMOTES.get(cape.getId());
}

function resolveEmote(player, slot, action, api) {
    const emote = EMOTES[slot];
    if (!emote) {
        return undefined;
    }

    if (emote.skillcape) {
        return resolveSkillcapeEmote(player, api);
    }

    if (emote.airGuitar) {
        const request = { player, unlocked: false };
        api.emitCustomEvent("music:air-guitar-unlocked", request);
        return request.unlocked === true ? { sequence: 4751, graphic: 1239 } : undefined;
    }

    if (emote.variants) {
        const index = variantIndices.get(player) || 0;
        variantIndices.set(player, (index + 1) % emote.variants.length);
        return { sequence: emote.variants[index] };
    }

    const loopSelected = emote.loopFirst ? action === 1 : action === 2;
    return { sequence: loopSelected && emote.loop ? emote.loop : emote.sequence };
}

module.exports = {
    name: "Emotes",
    _test: { questCapeReady, resolveSkillcapeEmote, resolveEmote },
    register(api) {
        const CombatFactory = api.getCombatFactory();

        api.onPlayerLogin(({ player }) => {
            // The login hook runs before the gameframe root is mounted. Sending the
            // flags in a microtask keeps them from being cleared by that root swap.
            queueMicrotask(() => enableEmoteActions(player));
        });

        // The Welcome Screen mounts the gameframe again after its play button is
        // pressed, so reapply the dynamic-child flags after that second root swap.
        api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, ({ player }) => {
            queueMicrotask(() => enableEmoteActions(player));
            return false;
        });

        api.onInterfaceActionButton(EMOTE_CONTENTS_UID, ({ player, slot, action }) => {
            if (!Number.isInteger(slot) || slot < 0 || slot > LAST_EMOTE_SLOT) {
                return false;
            }

            if (player.busy() || CombatFactory.inCombat(player)) {
                player.sendMessage("You cannot do this right now.");
                return true;
            }

            const emote = resolveEmote(player, slot, action, api);
            if (!emote) {
                if (EMOTES[slot].airGuitar) {
                    player.sendMessage("You need the Music cape to perform Air Guitar.");
                    return true;
                }
                const cape = player.getEquipment().getItems()[Equipment.CAPE_SLOT];
                const items = api.core.ItemIdentifiers;
                if (cape && (cape.getId() === items.QUEST_POINT_CAPE || cape.getId() === items.QUEST_POINT_CAPE_T_)) {
                    player.sendMessage("You need to complete every quest before performing the Quest point cape emote.");
                    return true;
                }
                player.sendMessage(
                    "You need to be wearing a skillcape in order to perform that emote.",
                );
                return true;
            }

            player.getSkillManager().stopSkillable();
            player.getMovementQueue().reset();
            player.setFollowing(null);
            player.performAnimation(new Animation(emote.sequence));
            if (emote.graphic !== undefined) {
                player.performGraphic(new Graphic(emote.graphic));
            }
            return true;
        });

        api.log("registered");
    },
};
