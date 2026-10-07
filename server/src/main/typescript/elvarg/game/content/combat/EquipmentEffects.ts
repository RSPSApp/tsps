import type { Mobile } from "../../entity/impl/Mobile";
import type { HitDamage } from "./hit/HitDamage";
import type { CombatType } from "./CombatType";

export type HitModifier = (entity: Mobile, baseHit: number) => number;
export interface CombatEffectiveLevelContext {
  combatType: CombatType;
  purpose: "accuracy" | "damage";
}
export type CombatEffectiveLevelModifier = (entity: Mobile, level: number, context: CombatEffectiveLevelContext) => number;
export type RunEnergyRestoreModifier = (entity: Mobile, delayMs: number) => number;
export interface IncomingDamageContext {
  type?: unknown;
  attacker?: Mobile;
  /** Melee attack bonus index (0 stab, 1 slash, 2 crush) when the hit is melee. */
  meleeAttackBonusIndex?: number;
}
export type IncomingDamageModifier = (entity: Mobile, hitDamage: HitDamage, context: IncomingDamageContext) => void;

const meleeHitModifiers: HitModifier[] = [];
const combatEffectiveLevelModifiers: CombatEffectiveLevelModifier[] = [];
const rangedHitModifiers: HitModifier[] = [];
const magicHitModifiers: HitModifier[] = [];
const magicDamageBonusModifiers: HitModifier[] = [];
const meleeAttackAccuracyModifiers: HitModifier[] = [];
const meleeDefenseModifiers: HitModifier[] = [];
const rangedAttackAccuracyModifiers: HitModifier[] = [];
const rangedDefenseModifiers: HitModifier[] = [];
const magicAttackAccuracyModifiers: HitModifier[] = [];
const magicDefenseModifiers: HitModifier[] = [];
const runEnergyRestoreModifiers: RunEnergyRestoreModifier[] = [];
const incomingDamageModifiers: IncomingDamageModifier[] = [];

const applyModifiers = (modifiers: HitModifier[], entity: Mobile, baseHit: number): number =>
  modifiers.reduce((damage, modifier) => {
    const next = modifier(entity, damage);
    return Number.isFinite(next) ? next : damage;
  }, baseHit);

const registerModifier = (modifiers: HitModifier[], modifier: HitModifier): void => {
  if (typeof modifier !== "function") {
    return;
  }
  modifiers.push(modifier);
};

export function registerMeleeHitModifier(modifier: HitModifier): void {
  registerModifier(meleeHitModifiers, modifier);
}

/** Runs after prayers/stance bonuses, before multiplying equipment bonuses. */
export function registerCombatEffectiveLevelModifier(modifier: CombatEffectiveLevelModifier): void {
  if (typeof modifier === "function") combatEffectiveLevelModifiers.push(modifier);
}

export function applyCombatEffectiveLevelModifiers(entity: Mobile, level: number, context: CombatEffectiveLevelContext): number {
  return combatEffectiveLevelModifiers.reduce((value, modifier) => {
    const next = modifier(entity, value, context);
    return Number.isFinite(next) ? next : value;
  }, level);
}

export function registerRangedHitModifier(modifier: HitModifier): void {
  registerModifier(rangedHitModifiers, modifier);
}

export function registerMagicHitModifier(modifier: HitModifier): void {
  registerModifier(magicHitModifiers, modifier);
}

export function registerMagicDamageBonusModifier(modifier: HitModifier): void {
  registerModifier(magicDamageBonusModifiers, modifier);
}

export function registerMeleeAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(meleeAttackAccuracyModifiers, modifier);
}

export function registerMeleeDefenseModifier(modifier: HitModifier): void {
  registerModifier(meleeDefenseModifiers, modifier);
}

export function registerRangedAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(rangedAttackAccuracyModifiers, modifier);
}

export function registerRangedDefenseModifier(modifier: HitModifier): void {
  registerModifier(rangedDefenseModifiers, modifier);
}

export function registerMagicAttackAccuracyModifier(modifier: HitModifier): void {
  registerModifier(magicAttackAccuracyModifiers, modifier);
}

export function registerMagicDefenseModifier(modifier: HitModifier): void {
  registerModifier(magicDefenseModifiers, modifier);
}

export function registerRunEnergyRestoreModifier(modifier: RunEnergyRestoreModifier): void {
  if (typeof modifier !== "function") {
    return;
  }
  runEnergyRestoreModifiers.push(modifier);
}

export function registerIncomingDamageModifier(modifier: IncomingDamageModifier): void {
  if (typeof modifier !== "function") {
    return;
  }
  incomingDamageModifiers.push(modifier);
}

export function applyMeleeHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(meleeHitModifiers, entity, baseHit);
}

export function applyRangedHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(rangedHitModifiers, entity, baseHit);
}

export function applyMagicHitModifiers(entity: Mobile, baseHit: number): number {
  return applyModifiers(magicHitModifiers, entity, baseHit);
}

/** The magic damage bonus in permille, after effects that add to it. */
export function applyMagicDamageBonusModifiers(entity: Mobile, permille: number): number {
  return applyModifiers(magicDamageBonusModifiers, entity, permille);
}

export function applyMeleeAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(meleeAttackAccuracyModifiers, entity, value);
}

export function applyMeleeDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(meleeDefenseModifiers, entity, value);
}

export function applyRangedAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(rangedAttackAccuracyModifiers, entity, value);
}

export function applyRangedDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(rangedDefenseModifiers, entity, value);
}

export function applyMagicAttackAccuracyModifiers(entity: Mobile, value: number): number {
  return applyModifiers(magicAttackAccuracyModifiers, entity, value);
}

export function applyMagicDefenseModifiers(entity: Mobile, value: number): number {
  return applyModifiers(magicDefenseModifiers, entity, value);
}

/** Milliseconds between run-energy points; modifiers divide by the restore-rate bonus. */
export function applyRunEnergyRestoreModifiers(entity: Mobile, delayMs: number): number {
  return runEnergyRestoreModifiers.reduce((delay, modifier) => {
    const next = modifier(entity, delay);
    return Number.isFinite(next) && next > 0 ? next : delay;
  }, delayMs);
}

/** Notifies listeners of a landed hit so they can reduce it or react (charges, set effects). */
export function applyIncomingDamageModifiers(entity: Mobile, hitDamage: HitDamage, context: IncomingDamageContext = {}): void {
  for (const modifier of incomingDamageModifiers) {
    modifier(entity, hitDamage, context);
  }
}
