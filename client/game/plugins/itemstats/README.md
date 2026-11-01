# Item stats

This plugin reads combat bonus params stored in each item definition in the loaded OSRS cache. `ItemStatsPlugin.getItemStats(itemId)` returns one item's bonuses. `compareItem(itemId)` reports the worn totals before and after replacing the matching equipment slot. When enabled, the plugin shows the bonuses and replacement deltas while you hover an item in your inventory, equipment, or bank.

Bonus parameter ids follow RuneLite's `ItemStats` mapping. Attack and defence bonuses use params 0-9, melee strength uses param 10, prayer uses param 11, ranged strength uses params 12 and 189, and magic damage uses param 299. The implementation also reads attack speed from param 14. Food effects come from the server's `food.json`; potion boosts and rune details use the plugin's local mappings.

Comparison replaces the candidate's equipment slot and any additional slots listed in its cache definition, such as a shield slot for a two-handed weapon. It does not calculate set effects or conditional bonuses. The tooltip also shows supported food and potion effects and basic rune details. Unknown food and unsupported potion effects are not inferred. Items with no displayed stats or effects do not get a tooltip.

The parameter mapping follows RuneLite's `ItemStats` data model. RuneLite's `ItemEquipmentStats.java` carries this BSD-2-Clause notice:

```text
Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT OWNER "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
