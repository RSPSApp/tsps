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

Ground transfers use generic core events shared by walking pickup and Telegrab:

- `ground-items:take`: `{player, groundItem, source, itemId, amount, discard:0,
  allow:true, error:null}`. `source` is `pickup` or `telegrab`. Policies may
  reduce `amount`, refuse the transfer, or explicitly discard part of the
  uncredited remainder; quantities must be integral and bounded by the source.
- `ground-items:taken`: `{player, groundItem, source, itemId, amount, discarded}`
  reports actual inventory credit after the source has been updated.

The capacity plugin counts every inventory/bank clue form of that tier and
applies the persisted case upgrades to both transfer paths. At capacity it
refuses another box. Below capacity it credits the available capacity from an
oversized box stack and destroys the excess, using the dedicated Scroll box
page's singular/plural messages after a successful transfer. A full inventory
that cannot accept a matching stack preserves the whole pile and produces no
destruction message. Legacy clue forms respect the same combined limit but
do not acquire box-specific excess-destruction behavior. An active clue scroll
also excludes a second active scroll of that tier, including one held in
graves, Death's Office or an implemented retrieval service; box capacity does
not increase the number of active scrolls.

Core rechecks source identity, quantity, metadata, owner, state, location,
private area and visibility after preparation callbacks, then recalculates
inventory capacity. Reentrant transfers are blocked for the same pile or
player until completion callbacks finish. No inventory credit means no
discard and no completion event. Walking-only quest hooks and spell timing
remain separate.

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

The dedicated Scroll box page distinguishes refusing a pickup at capacity
from destroying excess in an oversized stack below capacity. The general
Treasure Trails page has conflicting wording about destruction at capacity;
this implementation follows the dedicated page's detailed distinction. The
legacy-clue refusal message follows the Treasure Trails page.

This is an incremental parity change. Drop-warning settings, unsupported clue
routes, other-tier milestone awarders and Mimic acquisition/remaining tertiary
rules remain pending. Do not describe this as
complete Treasure Trails or Mimic parity. No generated reward artifact is edited.

Verification: `node --test tests/clue-capacity.test.cjs
tests/beginner-treasure-trails.test.cjs tests/mimic-payout.test.cjs
tests/mimic-session-state.test.cjs tests/ground-item-policy.test.cjs`. Regressions use the real cache, Inventory,
PlayerSave round trips and actual skilling/vessel handlers; no live account.
