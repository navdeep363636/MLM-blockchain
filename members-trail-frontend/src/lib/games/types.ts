import type { ComponentType } from "react";
import type { Rng } from "./rng";

/**
 * Per-title difficulty. One engine drives several titles, and this is what makes
 * them play differently — the alternative is four near-duplicate engines that
 * drift apart with every fix.
 */
export interface Tuning {
  /** How long a session runs, in seconds. */
  durationSeconds: number;
  /** 0 (gentle) … 1 (punishing). Engines read it however suits them. */
  intensity: number;
  /** Score awarded for the base success event, before any multiplier. */
  baseScore: number;
}

export interface EngineProps {
  /** The server's session seed. Every board is derived from it. */
  rng: Rng;
  tuning: Tuning;
  /** Emits one scoring event. Returns the running session score. */
  onScore: (delta: number) => number;
  /** The engine has nothing left to play — ends the session. */
  onFinish: () => void;
  /** Seconds left, owned by the host so the HUD and the engine agree. */
  secondsLeft: number;
  paused: boolean;
}

export type GameEngine = ComponentType<EngineProps>;

export interface EngineDefinition {
  key: string;
  /** Shown on the ready overlay: what the player is about to do. */
  name: string;
  /** One line of rules. The player should not need to guess the controls. */
  howToPlay: string;
  /** True when the engine needs a keyboard, so touch users can be warned. */
  keyboard: boolean;
  Component: GameEngine;
}
