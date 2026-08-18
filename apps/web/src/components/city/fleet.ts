/**
 * The Jaipur fleet, at real dimensions.
 *
 * docs/04 §2 lists twelve IRC classes; these are the eight that actually carry
 * the corridor. Dimensions are real vehicle sizes in metres — a two-wheeler is
 * 1.9 m long and a bus is 11 m, and rendering both as the same box throws away
 * the one fact probe data can never supply.
 *
 * `lateral` places a class across the carriageway: two-wheelers filter between
 * lanes and cluster at the kerb, buses and trucks hold the left lane. That
 * behaviour is what makes the scene read as Jaipur rather than as any road.
 */

export interface VehicleType {
  code: string;
  /** width, height, length in metres */
  dims: [number, number, number];
  /** night body colour before head/tail lighting is applied */
  night: string;
  /** daylight paint */
  day: string;
  /** -1 kerb .. +1 median; how far across the carriageway this class sits */
  lateral: number;
  /** spread around `lateral`; two-wheelers wander, buses do not */
  wander: number;
  /** multiplier on the link's mean speed */
  speed: number;
}

export const FLEET: VehicleType[] = [
  // Two-wheeler dominance is the whole ballgame (docs/04 §2). They filter
  // between lanes, which is why `wander` is the widest here.
  { code: "2W",   dims: [0.7, 1.2, 1.9],  night: "#FFF1CE", day: "#3C4250", lateral: 0.15, wander: 0.9, speed: 1.12 },
  { code: "CAR",  dims: [1.8, 1.5, 4.2],  night: "#FFF1CE", day: "#D6DAE2", lateral: 0.0,  wander: 0.4, speed: 1.0 },
  { code: "AUTO", dims: [1.4, 1.7, 2.6],  night: "#FFE9B0", day: "#E0C64A", lateral: -0.35, wander: 0.3, speed: 0.86 },
  { code: "ERIK", dims: [1.3, 1.8, 2.4],  night: "#FFE9B0", day: "#7FBF9A", lateral: -0.5, wander: 0.25, speed: 0.72 },
  { code: "LCV",  dims: [2.0, 2.2, 5.5],  night: "#FFF1CE", day: "#B8BCC4", lateral: -0.3, wander: 0.2, speed: 0.9 },
  { code: "BUS",  dims: [2.6, 3.2, 11.0], night: "#FFF6DE", day: "#4C7FB8", lateral: -0.45, wander: 0.12, speed: 0.84 },
  { code: "TRK2", dims: [2.5, 3.5, 8.0],  night: "#FFF1CE", day: "#8E9299", lateral: -0.5, wander: 0.12, speed: 0.8 },
  { code: "NMV",  dims: [0.6, 1.1, 1.8],  night: "#CFE6FF", day: "#6E7480", lateral: -0.62, wander: 0.2, speed: 0.34 },
];

export const TAIL_LIGHT = "#FF3B30";

/** Fallback when a link has no measured mix — the corridor-wide profile. */
export const DEFAULT_MIX: Record<string, number> = {
  "2W": 0.61, CAR: 0.24, AUTO: 0.062, ERIK: 0.028,
  LCV: 0.03, BUS: 0.012, TRK2: 0.01, NMV: 0.008,
};
