/**
 * Survival-Werte: Leben 20, Sättigung 20. „Nie nerven": kein Hungertod – bei Sättigung 0
 * gibt es nur keine Regeneration.
 */
export const SURVIVAL = {
  maxHealth: 20,
  maxHunger: 20,
  /** Sekunden je Sättigungspunkt. */
  hungerInterval: 90,
  /** Sekunden je Lebenspunkt Regeneration (bei Sättigung > 6). */
  regenInterval: 4,
  regenMinHunger: 6,
  /** Fallhöhe ohne Schaden (Blöcke). */
  safeFall: 3,
  /** Unverwundbarkeit nach Treffer (s). */
  hurtCooldown: 0.5,
} as const;

export interface SurvivalState {
  health: number;
  hunger: number;
  hungerTimer: number;
  regenTimer: number;
  hurtTimer: number;
  dead: boolean;
}

export function createSurvival(): SurvivalState {
  return {
    health: SURVIVAL.maxHealth,
    hunger: SURVIVAL.maxHunger,
    hungerTimer: 0,
    regenTimer: 0,
    hurtTimer: 0,
    dead: false,
  };
}

/** Zeit vergehen lassen; `sprinting` verdoppelt den Hunger. */
export function tickSurvival(s: SurvivalState, dt: number, sprinting: boolean): void {
  if (s.dead) return;
  s.hurtTimer = Math.max(0, s.hurtTimer - dt);
  s.hungerTimer += dt * (sprinting ? 2 : 1);
  while (s.hungerTimer >= SURVIVAL.hungerInterval) {
    s.hungerTimer -= SURVIVAL.hungerInterval;
    s.hunger = Math.max(0, s.hunger - 1);
  }
  if (s.hunger > SURVIVAL.regenMinHunger && s.health < SURVIVAL.maxHealth) {
    s.regenTimer += dt;
    while (s.regenTimer >= SURVIVAL.regenInterval) {
      s.regenTimer -= SURVIVAL.regenInterval;
      s.health = Math.min(SURVIVAL.maxHealth, s.health + 1);
    }
  } else {
    s.regenTimer = 0;
  }
}

/** Schaden zufügen. Liefert true, wenn er gewirkt hat. `ignoreCooldown` z. B. für Fallschaden. */
export function damage(s: SurvivalState, amount: number, ignoreCooldown = false): boolean {
  if (s.dead || amount <= 0) return false;
  if (!ignoreCooldown && s.hurtTimer > 0) return false;
  s.health = Math.max(0, s.health - amount);
  s.hurtTimer = SURVIVAL.hurtCooldown;
  if (s.health === 0) s.dead = true;
  return true;
}

export function eat(s: SurvivalState, food: number): boolean {
  if (s.dead || food <= 0 || s.hunger >= SURVIVAL.maxHunger) return false;
  s.hunger = Math.min(SURVIVAL.maxHunger, s.hunger + food);
  return true;
}

/** Fallschaden aus der Fallhöhe; bei vollem Leben nie tödlich. */
export function fallDamage(s: SurvivalState, fallHeight: number): number {
  const raw = Math.floor(fallHeight - SURVIVAL.safeFall);
  if (raw <= 0) return 0;
  return s.health === SURVIVAL.maxHealth ? Math.min(raw, s.health - 1) : raw;
}

export function respawn(s: SurvivalState): void {
  s.health = SURVIVAL.maxHealth;
  s.hunger = Math.max(s.hunger, 10);
  s.dead = false;
  s.hurtTimer = 1.5;
  s.regenTimer = 0;
}
