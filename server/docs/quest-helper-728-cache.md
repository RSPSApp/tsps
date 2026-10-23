# Issue 728 cache quest contracts

Read from active cache `osrs-241_2026-10-20`: quest DB table 0, column 19,
with progress readers from clientscript 4024 and completion comparison from 4029.
See [the reproduction process](agents/quest-testing.md#check-the-caches-completion-contract).

These are cache facts, not proof that a plugin matches them or that a quest was played.
The threshold is a lower bound for native completion, not proof of the exact final
post-quest value. Parent varp aliases need their bit layouts checked.

| Job | Quest | Quest DB row | Progress read | Completion threshold |
| --- | --- | --- | --- | --- |
| q001 | Animal Magnetism | 0 | varbit 3185 | 240 |
| q002 | Another Slice of H.A.M. | 1 | varbit 3550 | 11 |
| q003 | The Ascent of Arceuus | 3 | varbit 7856 | 14 |
| q004 | At First Light | 3513 | varbit 9835 | 12 |
| q005 | Between a Rock... | 7 | varbit 299 | 110 |
| q006 | Big Chompy Bird Hunting | 8 | varp 293 | 65 |
| q007 | Biohazard | 9 | varp 68 | 16 |
| q008 | Bone Voyage | 11 | varbit 5795 | 50 |
| q009 | Cabin Fever | 12 | varp 655 | 140 |
| q010 | Client of Kourend | 13 | varbit 5619 | 7 |
| q011 | Clock Tower | 14 | varp 10 | 8 |
| q012 | Cold War | 15 | varbit 3293 | 135 |
| q013 | Creature of Fenkenstrain | 19 | varbit 13715 | 9 |
| q014 | The Curse of Arrav | 3937 | varbit 11479 | 60 |
| q015 | Darkness of Hallowvale | 22 | varbit 2573 | 320 |
| q016 | Death on the Isle | 3711 | varbit 11210 | 50 |
| q017 | Death Plateau | 23 | varp 314 | 80 |
| q018 | Death to the Dorgeshuun | 24 | varbit 2258 | 13 |
| q019 | The Depths of Despair | 26 | varbit 6027 | 11 |
| q020 | Desert Treasure I | 27 | varbit 358 | 15 |
| q021 | Desert Treasure II - The Fallen Empire | 2343 | varbit 14862 | 118 |
| q022 | Devious Minds | 28 | varbit 1465 | 80 |
| q023 | The Dig Site | 29 | varp 131 | 9 |
| q024 | Dragon Slayer II | 32 | varbit 6104 | 215 |
| q025 | Dream Mentor | 33 | varbit 3618 | 28 |
| q026 | Druidic Ritual | 34 | varp 80 | 4 |
| q027 | Dwarf Cannon | 35 | varp 0 | 11 |
| q028 | Eadgar's Ruse | 36 | varp 335 | 110 |
| q029 | Eagles' Peak | 37 | varbit 2780 | 40 |
| q030 | Elemental Workshop I | 38 | varbit 13718 | 2 |
| q031 | Elemental Workshop II | 39 | varbit 2639 | 11 |
| q032 | Enakhra's Lament | 40 | varbit 1560 | 70 |
| q033 | Enlightened Journey | 42 | varbit 2866 | 200 |
| q034 | Ethically Acquired Antiquities | 3713 | varbit 11193 | 38 |
| q035 | The Eyes of Glouphrie | 45 | varbit 2497 | 60 |
| q036 | Fairytale I - Growing Pains | 46 | varbit 1803 | 90 |
| q037 | Fairytale II - Cure a Queen | 47 | varbit 2326 | 90 |
| q038 | Family Crest | 48 | varp 148 | 11 |
| q039 | The Feud | 50 | varbit 334 | 28 |
| q040 | Fight Arena | 51 | varp 17 | 14 |
| q041 | Fishing Contest | 52 | varp 11 | 5 |
| q042 | Forgettable Tale... | 53 | varbit 822 | 140 |
| q043 | The Forsaken Tower | 54 | varbit 7796 | 11 |
| q044 | The Fremennik Isles | 56 | varbit 3311 | 340 |
| q045 | The Fremennik Trials | 57 | varp 347 | 10 |
| q046 | The Garden of Death | 180 | varbit 14609 | 56 |
| q047 | Garden of Tranquillity | 58 | varbit 961 | 60 |
| q048 | Gertrude's Cat | 60 | varp 180 | 6 |
| q049 | Getting Ahead | 61 | varbit 693 | 34 |
| q050 | Ghosts Ahoy | 62 | varbit 217 | 8 |
| q051 | The Grand Tree | 66 | varp 150 | 160 |
| q052 | The Great Brain Robbery | 67 | varp 980 | 130 |
| q053 | Grim Tales | 68 | varbit 2783 | 60 |
| q054 | The Hand in the Sand | 69 | varbit 1527 | 160 |
| q055 | Hazeel Cult | 71 | varp 223 | 9 |
| q056 | The Heart of Darkness | 3710 | varbit 11117 | 76 |
| q057 | Heroes' Quest | 72 | varp 188 | 15 |
| q058 | Holy Grail | 73 | varp 5 | 10 |
| q059 | Horror from the Deep | 74 | varbit 34 | 10 |
| q060 | Icthlarin's Little Helper | 75 | varbit 418 | 26 |
| q061 | In Aid of the Myreque | 77 | varbit 1990 | 430 |
| q062 | In Search of the Myreque | 79 | varp 387 | 105 |
| q063 | Jungle Potion | 80 | varp 175 | 12 |
| q064 | King's Ransom | 82 | varbit 3888 | 90 |
| q065 | A Kingdom Divided | 81 | varbit 12296 | 150 |
| q066 | Legends' Quest | 85 | varp 139 | 75 |
| q067 | Lost City | 86 | varp 147 | 6 |
| q068 | The Lost Tribe | 87 | varbit 532 | 11 |
| q069 | Lunar Diplomacy | 88 | varbit 2448 | 190 |
| q070 | Making Friends with My Arm | 91 | varbit 6528 | 200 |
| q071 | Making History | 92 | varbit 1383 | 4 |
| q072 | Meat and Greet | 3712 | varbit 11182 | 26 |
| q073 | Merlin's Crystal | 93 | varp 14 | 7 |
| q074 | Monk's Friend | 97 | varp 30 | 80 |
| q075 | Monkey Madness I | 95 | varp 365 | 9 |
| q076 | Monkey Madness II | 96 | varbit 5027 | 195 |
| q077 | Mountain Daughter | 98 | varbit 260 | 70 |
| q078 | Mourning's End Part I | 99 | varp 517 | 9 |
| q079 | Mourning's End Part II | 100 | varbit 1103 | 60 |
| q080 | Murder Mystery | 101 | varp 192 | 2 |
| q081 | My Arm's Big Adventure | 102 | varbit 2790 | 320 |
| q082 | Nature Spirit | 103 | varp 307 | 110 |
| q083 | A Night at the Theatre | 104 | varbit 12276 | 86 |
| q084 | Observatory Quest | 105 | varp 112 | 7 |
| q085 | Olaf's Quest | 106 | varbit 3534 | 80 |
| q086 | One Small Favour | 107 | varp 416 | 285 |
| q087 | Plague City | 109 | varp 165 | 29 |
| q088 | A Porcine of Interest | 110 | varbit 10582 | 40 |
| q089 | Priest in Peril | 111 | varp 302 | 60 |
| q090 | The Queen of Thieves | 113 | varbit 6037 | 13 |
| q091 | Rag and Bone Man I | 114 | varp 714 | 4 |
| q092 | Rag and Bone Man II | 115 | varp 714 | 6 |
| q093 | Ratcatchers | 116 | varbit 1404 | 127 |
| q094 | Recipe for Disaster | 117 | varbit 1850 | 5 |
| q095 | Recruitment Drive | 118 | varbit 657 | 2 |
| q096 | Regicide | 119 | varp 328 | 15 |
| q097 | The Ribbiting Tale of a Lily Pad Labour Dispute | 3515 | varbit 9844 | 32 |
| q098 | Roving Elves | 122 | varp 402 | 6 |
| q099 | A Ruff Situation | 16971 | varbit 15889 | 120 |
| q100 | Rum Deal | 124 | varp 600 | 19 |
| q101 | Scorpion Catcher | 126 | varp 76 | 6 |
| q102 | Sea Slug | 127 | varp 159 | 12 |
| q103 | Sheep Herder | 130 | varp 60 | 3 |
| q104 | Shilo Village | 133 | varp 116 | 15 |
| q105 | Sleeping Giants | 169 | varbit 13902 | 30 |
| q106 | The Slug Menace | 136 | varbit 2610 | 14 |
| q107 | Song of the Elves | 137 | varbit 9016 | 200 |
| q108 | A Soul's Bane | 138 | varbit 2011 | 13 |
| q109 | Swan Song | 140 | varbit 2098 | 200 |
| q110 | A Tail of Two Cats | 142 | varbit 1028 | 70 |
| q111 | Tale of the Righteous | 143 | varbit 6358 | 17 |
| q112 | A Taste of Hope | 144 | varbit 6396 | 165 |
| q113 | Tears of Guthix | 145 | varbit 451 | 2 |
| q114 | Temple of Ikov | 146 | varp 26 | 80 |
| q115 | The Tourist Trap | 148 | varp 197 | 30 |
| q116 | Tower of Life | 149 | varbit 3337 | 18 |
| q117 | Tree Gnome Village | 150 | varp 111 | 9 |
| q118 | Tribal Totem | 151 | varp 200 | 5 |
| q119 | Troll Romance | 152 | varp 385 | 45 |
| q120 | Troll Stronghold | 153 | varp 317 | 50 |
| q121 | Twilight's Promise | 3512 | varbit 9649 | 50 |
| q122 | Underground Pass | 154 | varp 161 | 11 |
| q123 | Wanted! | 156 | varbit 1051 | 11 |
| q124 | Watchtower | 157 | varp 212 | 13 |
| q125 | What Lies Below | 159 | varbit 3523 | 150 |
| q126 | While Guthix Sleeps | 3467 | varbit 9653 | 900 |
| q127 | Witch's House | 160 | varp 226 | 7 |
| q128 | Zogre Flesh Eaters | 163 | varbit 487 | 14 |
| q129 | Learning the Ropes | 9643 | varp 281 | 671 |
| q130 | His Faithful Servants | 3250 | varbit 14973 | 10 |

Learning the Ropes has a cache contract but no helper in the pinned Quest Helper checkout.
His Faithful Servants is a supporting prerequisite. Museum Kudos is not a quest DB row.
