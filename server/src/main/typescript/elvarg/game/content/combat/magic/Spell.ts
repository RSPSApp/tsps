import { Misc } from "../../../../util/Misc";
import { Mobile } from "../../../entity/impl/Mobile";
import { Player } from "../../../entity/impl/player/Player";
import { Equipment } from "../../../model/container/impl/Equipment";
import { Item } from "../../../model/Item";
import { MagicSpellbook } from "../../../model/MagicSpellbook";
import { Skill } from "../../../model/Skill";
import { PluginManager } from "../../../../plugins/PluginManager";

export abstract class Spell {
    private static readonly NEXT_CAST_AT = "magic:next-cast-at";
    private static readonly CAST_DELAY_MS = 600;

    abstract spellId(): number;
    abstract levelRequired(): number;
    abstract itemsRequired(player: Player): Item[];
    abstract equipmentRequired(player: Player): Item[];
    abstract startCast(cast: Mobile, castOn: Mobile): void
    abstract baseExperience();

    /** Members-only on the standard spellbook; free-to-play worlds disable it (other books are all members). */
    public members = false;

    public isMembers(): boolean {
        return this.members;
    }

    public getSpellbook(): MagicSpellbook {
        return MagicSpellbook.NORMAL;
    }

    /** Extra per-spell cooldowns. */
    protected getCastCooldown(): { attribute: string, duration: number } | null {
        return null;
    }

    /** Direct-damage spells share a one-tick cast gate; utility spells do not. */
    protected usesSharedCastDelay(): boolean {
        return false;
    }

    public itemsToConsume(player: Player, items = this.itemsRequired(player)): Item[] {
        if (!Array.isArray(items) || PluginManager.emitSpellRuneBypass(
            player, this.getSpellbook(), this.spellId()
        ) === true) {
            return [];
        }
        return items.filter((item) => item != null && PluginManager.emitSpellRuneBypass(
            player, this.getSpellbook(), this.spellId(), item.id
        ) !== true);
    }

    canCast(player: Player, del: boolean): boolean {
        if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < this.levelRequired()) {
            player.sendMessage(`You need a Magic level of ${this.levelRequired()} to cast this spell.`);
            player.getCombat().reset();
            return false;
        }

        if (
            PluginManager.emitSpellDisabled(
                player,
                this.getSpellbook(),
                this.spellId(),
                this
            ) === true
        ) {
            player.getCombat().setCastSpell(null);
            player.getCombat().reset();
            return false;
        }

        if (player.getSpellbook() !== this.getSpellbook()) {
            const { Autocasting } = require("./Autocasting");
            Autocasting.setAutocast(player, null);
            player.getCombat().setCastSpell(null);
            player.getCombat().reset();
            return false;
        }

        const items = this.itemsRequired(player);
        let itemsToConsume: Item[] = [];
        if (Array.isArray(items) && items.length > 0) {
            itemsToConsume = this.itemsToConsume(player, items);

            if (!player.getInventory().containsAllItem(itemsToConsume)) {
                player.sendMessage("You do not have the required items to cast this spell.");
                player.getCombat().setCastSpell(null);
                player.getCombat().reset();
                return false;
            }

            const equipment = this.equipmentRequired(player);
            if (Array.isArray(equipment) && equipment.length > 0 && !player.getEquipment().containsAllItem(equipment)) {
                player.sendMessage("You do not have the required equipment to cast this spell.");
                player.getCombat().setCastSpell(null);
                player.getCombat().reset();
                return false;
            }

        }

        if (!del) {
            return true;
        }

        const now = Date.now();
        const cooldown = this.getCastCooldown();
        if ((this.usesSharedCastDelay() && Number(player.getAttribute(Spell.NEXT_CAST_AT) ?? 0) > now) ||
            (cooldown != null && Number(player.getAttribute(cooldown.attribute) ?? 0) > now)) {
            return false;
        }

        if (player.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId() == 11791 && Misc.getRandom(7) == 1) {
            player.sendMessage("Your Staff of the dead negated your runes for this cast.");
        } else {
            for (const item of itemsToConsume) {
                player.getInventory().deletes(item);
            }

            if (player.getAttribute?.("lunar:spellbook-swap")) {
                player.setAttribute("lunar:spellbook-swap", null);
                MagicSpellbook.changeSpellbook(player, MagicSpellbook.LUNAR, true);
            }
        }

        if (this.usesSharedCastDelay()) {
            player.setAttribute(Spell.NEXT_CAST_AT, now + Spell.CAST_DELAY_MS);
        }
        if (cooldown != null) {
            player.setAttribute(cooldown.attribute, now + cooldown.duration);
        }

        return true;
    }

}
