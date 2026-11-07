# Iban's staff

- **Plugin:** `server/plugins/items/IbansStaff.plugin.js`; the Iban Blast spell itself is `CombatSpells.IBAN_BLAST`. The Dark Mage's
  upgrade is in `server/plugins/achievements/diaries/ArdougneIbanStaffDiary.plugin.js`.
- **Test:** `server/tests/ibans-staff.test.cjs`

## Charges

From the OSRS Wiki ([Iban's staff](https://oldschool.runescape.wiki/w/Iban%27s_staff), [Iban Blast](https://oldschool.runescape.wiki/w/Iban_Blast)):

- Iban Blast uses **1 charge** on an NPC and **2** on another player. Other spells use none.
- Iban's staff holds **120** charges, Iban's staff (u) **2,500**.
- The Dark Mage recharges for 100,000 coins (staff) or 250,000 coins (upgraded) and upgrades for 200,000 coins, which "fully charges it".
- The staff has a **Check** option.

How it works here:

- The count is the item meta `ibans-staff:charges`. A staff with no saved count is full, which is how the quest reward, an upgrade and a repair hand it out.
- `magic:cast-committed` spends the charges when the cast is paid for; `onSpellDisabled` refuses Iban Blast at 0 charges. A player cast on the last charge leaves 0.
- The Dark Mage's "Can you recharge my Staff of Iban?" branch answers its two conditions (already full / not enough coins) and takes the payment. The transcript's text says 100,000 coins; for the upgraded staff the plugin charges 250,000.
- `item:fill-charges` hands loadouts a full staff.

Checked through the agent MCP (not the empty-staff refusal, which only the unit test covers): Check on the upgraded staff reads 2,500; three NPC casts took the staff from 120 to 117; one cast on a player takes 2; the Dark Mage takes 100,000 coins and restores 120.

## Not known

The Wiki gives no text for the Check message, the empty-staff refusal or what a staff at 0 charges turns into (it never says the staff breaks), so those messages are ours and the staff stays as it is at 0. Where the broken staff comes from is not documented either. The recharge well in the Underground Pass is not implemented: the Wiki names no object, tile or messages for it. No rsprox capture shows a charged cast or the Dark Mage's recharge.
