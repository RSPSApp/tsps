# Revenant weapons

`server/plugins/items/RevenantWeapons.plugin.js` covers Viggora's chainmace, the Ursine chainmace and Craw's bow. The Webweaver bow is `WebweaverBow.plugin.js` and the accursed and Thammaron's sceptres are `AccursedSceptre.plugin.js` ([Powered staves](powered-staves.md)).

**Sources:** the OSRS Wiki pages "Viggora's chainmace", "Ursine chainmace", "Craw's bow" and "Thammaron's sceptre". No rsprox recording shows these weapons, so their messages follow the captured Webweaver bow and accursed sceptre ones ("Your bow has N charges left powering it.", "Your sceptre has N charges left powering it.") with the weapon's own word (chainmace, bow, sceptre). That wording is an assumption.

## Ether
- Activated with 1,000 revenant ether (use the ether on the weapon). That is not a charge: up to 16,000 more are, so 17,000 in all.
- The ether prompt, the busy varbit and the activation and top-up messages are the Webweaver bow's:
  - "You use 1,000 ether to activate the weapon."
  - "You add a further N revenant ether to your weapon, giving it a total of N charges."
- Check: "Your chainmace has N charges left powering it." (bow: "Your bow …").
- **Uncharge** returns every ether, the activation ether included. A weapon that did not have its activation ether paid through the weapon (a shop or spawn) refunds and drops only its charges.
- **Dismantle** on an uncharged weapon gives 7,500 revenant ether.

## Attacks
- Each attack spends one ether, hit or miss, in or out of the Wilderness. The chainmaces spend it as the swing starts; Craw's bow as the shot is paid.
- Emptied, a weapon stays activated. A chainmace then swings as an ordinary mace. Craw's bow needs no arrows but cannot fire without ether: "There is not enough revenant ether left powering your bow."
- **Passive:** charged, +50% accuracy and +50% damage against NPCs in the Wilderness. It does not apply to players. The last ether still gives the attack it paid for the passive.
- The passive is applied after the other bonuses. The Wiki's stacking rules with a Slayer helmet or a Salve amulet (and that the two do not combine) are not modelled.

## Death
Dying to a player in the Wilderness drops all the ether to the killer even when the weapon is protected, and the weapon comes back uncharged.

## Not covered
- The Ursine chainmace's special attack, Bear Down: it needs a charged mace, 50% energy, doubled accuracy against slash defence, 20 damage over 6 seconds, a 6-tick run block and 20 Agility drained (Wiki: Ursine chainmace). Not implemented.
- The bank's Configure-Charges option.
- Deaths to monsters in the Wilderness: the existing Webweaver bow rule (killed by a player) is followed.
