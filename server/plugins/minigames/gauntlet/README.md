# Echo Hunllef placeholder

Echo Hunllef uses the normal Corrupted Hunllef controller: normal style/prayer switching,
stomp, tornadoes and floor patterns. It does **not** implement the live Echo triple-prayer
or lightning mechanics. Echo models, HP, levels, bonuses, speed and maximum hit are supplied
by the shared Echo boss service. Normal magic/ranged caps are scaled from the documented
Echo 85 unarmoured maximum using the existing Corrupted armour/protection ratios, rounded
down. These reduced caps are explicitly derived placeholder values. Stomp and hazard damage
retain the normal encounter rules.

Echo entry skips preparation and supplies all three perfected corrupted weapons, perfected
corrupted armour, fourteen paddlefish, two four-dose egniol potions and a perfected crystal
dagger. Song of the Elves/Bryn, pet and pending-reward entry checks still apply.

Original inventory/equipment slots, quantities and metadata are synchronously saved in the
profile's `gauntlet:echo-equipment-escrow` before temporary equipment replaces them. All exit
paths restore them, including death, disconnect during the entry fade, and reconnect after a
server interruption. Malformed escrow is retained for recovery rather than deleting items.

A successful Echo completion queues its unique roll once in the persisted normal corrupted
reward chest, alongside ordinary corrupted loot. It does not roll another Echo orb. Ordinary
corrupted completion counts remain credited; zero-preparation times and the supplied kit do
not award ordinary personal bests or conditional/speed achievements. Temporary kit is removed
before originals return, and instance hazards/NPCs disappear with the run.

Verification extends `server/tests/gauntlet.test.cjs` for escrow, supplies, all exit paths,
save-shaped recovery, malformed data and chest overflow/replay. The ordinary Gauntlet suite
continues covering the shared controller independently.
