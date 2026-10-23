# Clue capacity and scroll cases

`ClueCapacity` owns the shared capacity and case state for all six tiers.
The old beginner minor/major attribute names are retained for existing saves.
Before X Marks the Spot, the receipt limit is one; afterward the combined
scroll/box/vessel limit is two plus consumed minor, major and Mimic bonuses.
The Mimic bonus applies to every tier, including beginner on free worlds.
Members cases cannot be opened on free worlds.

Box opening checks active clues in inventory, every bank tab, graves, Death's
Office and the implemented item retrieval services. The generic
`item-retrieval:items` query returns `{itemId, amount}` records from each storage
owner without changing that storage. Current owners: Zulrah, Nightmare, Yama,
Theatre of Blood and Hespori.

Custom events:

- `treasure-trails:capacity`: `{player, tier, capacity:null}`.
- `treasure-trails:can-receive`: `{player, tier, allowed:null}`.
- `treasure-trails:clue-item`: `{player, itemId, box:false}` resolves a reward
  into its post-quest box, without granting it.
- `treasure-trails:open-vessel`: an item-action event; recognized requests are
  handled even when the clicked item is stale.
- `treasure-trails:case-eligible`: `{player, itemId, eligible:null}` excludes
  consumed cases and copies held in inventory or bank.
- `treasure-trails:milestone-rewards`: `{player, completed, milestones, drops, handled:false, error:null}`
  adds eligible canonical milestone rows. It does not invent reward thresholds.
  The service sets `handled` even when no case is eligible; callers can preserve
  their casket if the service is missing or reports an error.

Item IDs and case varbits come from the installed cache's named identifiers.
The thirteen consumed flags are registered for persistence and sent on login.
Opening a Mimic includes its canonical scroll-case tertiary only when the case
service answers eligible; an unavailable service preserves the casket.

Sources checked23 October2026:

- [Treasure Trails](https://oldschool.runescape.wiki/w/Treasure_Trails)
- [Scroll case](https://oldschool.runescape.wiki/w/Scroll_case)
- [Scroll box](https://oldschool.runescape.wiki/w/Scroll_box)
- [Mimic scroll case](https://oldschool.runescape.wiki/w/Mimic_scroll_case)
- [Clue geode](https://oldschool.runescape.wiki/w/Clue_geode)
- [Clue nest](https://oldschool.runescape.wiki/w/Clue_nest)

This is an incremental parity change. Ground pickup/Telegrab box caps and their
messages remain pending, as do unsupported clue routes, other-tier milestone
awarders and Mimic acquisition/remaining tertiary rules. Do not describe this as
complete Treasure Trails or Mimic parity. No generated reward artifact is edited.

Verification: `node --test tests/clue-capacity.test.cjs
tests/beginner-treasure-trails.test.cjs tests/mimic-payout.test.cjs
tests/mimic-session-state.test.cjs`. Regressions use the real cache, Inventory,
PlayerSave round trips and actual skilling/vessel handlers; no live account.
