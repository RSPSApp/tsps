# Lumbridge & Draynor diary audit

Issue [#2426](https://github.com/RSPSApp/tsps/issues/2426) tracks the 41 tasks in the Lumbridge & Draynor diary. Diary progress is granted only after the source action reports success, then passes the task's location, item, NPC, quest, skill, or route checks. Repeated events are harmless because `AchievementDiaries` stores task completion idempotently.

## Coverage

| Tier | Task | Status |
|---|---|---|
| Easy | Draynor Village agility lap | Existing course completion hook. |
| Easy | Cave bug beneath Lumbridge Swamp | NPC death, either standard Cave bug ID, cave bounds; the Cave bug larva does not count. |
| Easy | Sedridor's Essence Mine teleport | Existing Runecrafting quest hook. |
| Easy | Craft water runes from essence | Successful altar event and rune, pure, or daeyalt essence check, including Ourania outputs. |
| Easy | Learn age from Hans | Existing Hans dialogue hook. |
| Easy | Pickpocket a Lumbridge man or woman | Existing successful pickpocket hook. |
| Easy | Chop and burn oak logs in Lumbridge | Successful chop then successful burn, both in Lumbridge. |
| Easy | Kill zombie in Draynor sewers | Existing NPC death hook preserved. |
| Easy | Catch anchovies in Al Kharid | Successful anchovy catch in the Al Kharid fishing bounds. |
| Easy | Bake bread on Lumbridge kitchen range | Successful bread output on the range at the castle kitchen. |
| Easy | Mine iron ore at Al Kharid mine | Successful iron ore output within the mine bounds. |
| Easy | Enter H.A.M. hideout | Existing trapdoor arrival hook. |
| Medium | Al Kharid agility lap | Existing course completion hook. |
| Medium | Grapple across River Lum | Completed `Broken Raft` agility crossing; only the grapple route credits the task. |
| Medium | Purchase upgraded device from Ava | Ava's `Devices` action validates quest completion, base Ranged 50, 75 steel arrows and the attractor/coin payment; credit follows delivery. |
| Medium | Fairy ring to Wizards' Tower | Successful arrival with code DIS at the tower. |
| Medium | Cast Lumbridge teleport | Successful teleport arrival by the named spell in Lumbridge. |
| Medium | Catch salmon in Lumbridge | Successful salmon catch in Lumbridge. |
| Medium | Craft coif in Lumbridge cow pen | Successful Crafting product in the cow pen. |
| Medium | Chop willow logs in Draynor | Successful willow chop in Draynor. |
| Medium | Pickpocket Martin | Successful pickpocket of Martin the Master Gardener. |
| Medium | Get a Slayer task from Chaeldar | Task-assigned event from Chaeldar. |
| Medium | Catch essence or eclectic impling in Puro-Puro | Successful capture with Puro-Puro flag and matching impling ID. |
| Medium | Craft lava runes at Al Kharid Fire Altar | Unsupported: the server has no combination-rune crafting action. The diary does not award credit for ordinary fire runes. |
| Hard | Cast Bones to Peaches in Al Kharid Palace | Core spell effect emits success only after bones were converted; palace bounds required. |
| Hard | Squeeze past Zanaris jutting wall | Successful completion of either configured Jutting Wall shortcut. |
| Hard | Craft 56 Cosmic runes at once | Successful altar event; valid essence source and actual rune total required, including Ourania outputs. |
| Hard | Travel Lumbridge to Edgeville by Waka canoe | Existing arrival hook corrected to the catalogue key `lumbridge`. |
| Hard | Collect 100 Tears of Guthix | Existing successful collection and threshold hook. |
| Hard | Take Dorgesh-Kaan to Keldagrim train | Unsupported: there is no implemented train ride path or verified capture to identify a successful trip. |
| Hard | Purchase Barrows gloves from Culinaromancer's Chest | Successful purchase event, chest shop, gloves item and Lumbridge Castle basement bounds. |
| Hard | Pick belladonna at Draynor patch | Successful harvest from the canonical belladonna patch ID and tile. |
| Hard | Light mining helmet in Lumbridge Castle | Tinderbox action now lights the unlit helmet at Firemaking 65; diary checks the castle basement. |
| Hard | Recharge Prayer at Emir's Arena with Smite | Successful Prayer increase at an altar in the arena while Smite is active. |
| Hard | Craft, string and enchant amulet of power in Lumbridge | Persisted sequence of diamond amulet (u), stringing, and Lvl-4 Enchant; each action must happen on Lumbridge ground floor. |
| Elite | Steal from Dorgesh-Kaan rich chest | Unsupported: chest IDs are known, but no thieving chest interaction is implemented. |
| Elite | Grapple across Dorgesh-Kaan course pylon | Unsupported: the Dorgesh-Kaan course traversal and verified pylon endpoints are not implemented. |
| Elite | Chop magic logs at Mage Training Arena | Successful magic chop within the MTA bounds. |
| Elite | Smith adamant platebody in Draynor sewer | Successful smithing output in the Draynor sewer region. |
| Elite | Craft at least 140 water runes at once | Successful altar event; valid essence source and actual rune total required, including Ourania outputs. |
| Elite | Quest cape emote in Wise Old Man's house | Successful cape emote sequence with either Quest point cape variant in the house bounds. |

## Verification notes

The diary adapters use successful skill, transport, shop, farming, prayer, emote, and spell events. The task list in `achievement-diaries.json` is generated cache-backed data and was not changed. The existing Sedridor, Hans, Lumbridge pickpocket, Draynor zombie, H.A.M., Agility-course, Tears of Guthix, and canoe behaviors are preserved.

The River Lum shortcut already had cache-backed crossing requirements and map ends but referenced a missing script. It now reports the selected route (`grapple` or `barehanded`); the diary handler credits only `grapple`, matching the task text. The current Wiki also documents a level-48 barehanded crossing, but it is not the task's grapple action.

Primary task reference: [Lumbridge & Draynor Diary](https://oldschool.runescape.wiki/w/Lumbridge_%26_Draynor_Diary). Activity references: [Mith grapple](https://oldschool.runescape.wiki/w/Mithril_grapple), [Dorgesh-Kaan](https://oldschool.runescape.wiki/w/Dorgesh-Kaan), [Dorgesh-Kaan Rich Chest](https://oldschool.runescape.wiki/w/Chest_%28Dorgesh-Kaan_Rich%29), and [2026 Agility changes](https://oldschool.runescape.wiki/w/Update%3ASummer_Sweep_Up_-_Agility_%26_Chambers_of_Xeric_Changes).
