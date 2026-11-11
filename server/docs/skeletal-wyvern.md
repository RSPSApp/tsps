# Skeletal wyverns (issue 4191)

`plugins/bosses/SkeletalWyvern.plugin.js` gives NPCs 465-468 a bite/tail swipe (melee, max 13), an iceball
(ranged, max 13, 6 tiles) and an icy breath (5 tiles, max 50, shield 10, Protect from Magic 20, 6.6 s freeze
unless an ancient wyvern shield is worn). Source: the OSRS wiki Skeletal_Wyvern, Strategies and Dragonfire pages.
Animations/graphics are the cache's WYVERN_SKELETON_* ids (seq 2985/2986/2988/2989, spotanim 499-502).

Guesses, no rsprox capture of a wyvern fight exists: attack choice odds (melee range 50% bite, 25% each ranged;
beyond it iceball/breath alternate, iceball only past 5 tiles), the freeze chance without a shield (always) and
with one (1 in 7), launch/impact graphic heights and projectile timing copied from the KBD.
