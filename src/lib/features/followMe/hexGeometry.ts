import { RADIUS_POKEMON } from "@/lib/constants";
import { Coords } from "@/lib/utils/coordinates";
import { rangeDestination, type RangePosition } from "@/lib/utils/rangeGeometry";

/**
 * Follow-me scan geometry: 7 M-sized scout scans, hexagonally tiled.
 *
 * Kept free of Svelte runes so the geometry tests can import it directly,
 * unlike scout.svelte.ts. getCoords() in that file stays the single source of
 * truth for the M ring itself; hexGeometry.test.ts asserts the two agree.
 */

/**
 * Spacing between neighbouring 70 m GMO circles.
 *
 * At RADIUS_POKEMON * sqrt(3) the circles are an exact gapless hexagonal
 * cover: three mutually adjacent centres sit on an equilateral triangle whose
 * circumradius is exactly RADIUS_POKEMON, so the cover has zero margin. The
 * 1.732 truncation of sqrt(3) biases spacing ~4 mm inward, and that bias is
 * the only margin there is. Keep the literal identical to getCoords().
 */
export const HEX_RING_METERS = RADIUS_POKEMON * 1.732;

/** Bearings of an M scan's six outer points, degrees clockwise from north. */
const RING_BEARINGS = [0, 60, 120, 180, 240, 300];

/**
 * Distance from the centre M to each of the six surrounding M centres.
 *
 * Seven M-flowers tile the plane as the N = 7 hexagonal superlattice. Its
 * generator is 2*a1 + a2, which is sqrt(7) lattice steps long - so the cluster
 * offset is HEX_RING_METERS * sqrt(7), or equivalently RADIUS_POKEMON *
 * sqrt(21) ~ 320.78 m.
 */
export const HEX7_CLUSTER_METERS = HEX_RING_METERS * Math.sqrt(7);

/**
 * Bearing of the first surrounding M centre, atan(sqrt(3) / 5) ~ 19.1066
 * degrees. The N = 7 superlattice is rotated off the ring bearings by exactly
 * this much; the remaining five follow every 60 degrees.
 */
export const HEX7_CLUSTER_BEARING = (Math.atan2(Math.sqrt(3), 5) * 180) / Math.PI;

/** 7 M scans of 7 points each. */
export const HEX7_POINT_COUNT = 49;

/**
 * Largest radius around the centre that getHex7Coords() covers with no gap,
 * measured on a 4 m grid by hexGeometry.test.ts. The union reaches ~507 m at
 * its widest, but only this inner disc is guaranteed whole.
 */
export const HEX7_COVERED_RADIUS_METERS = 371;

/** One M scan: its centre plus six points one ring step out. */
function ring(center: RangePosition): RangePosition[] {
	return [
		center,
		...RING_BEARINGS.map((bearing) => rangeDestination(center, HEX_RING_METERS, bearing))
	];
}

/**
 * The 49 scout locations for a follow-me scan centred on the user.
 *
 * Every point is placed with rangeDestination(), the same spherical-trig
 * producer the game's own range circles use, so the tiling holds at any
 * latitude rather than shearing the way a flat lat/lon offset would. Each M is
 * built from its own centre, which keeps the inner ring exact and leaves only
 * meridian convergence between clusters - about 13 mm over 320 m, far below
 * the sqrt(3) truncation margin.
 */
export function getHex7Coords(center: Coords): Coords[] {
	const origin = center.geojson();
	const clusterCenters: RangePosition[] = [origin];

	for (let i = 0; i < 6; i++) {
		clusterCenters.push(
			rangeDestination(origin, HEX7_CLUSTER_METERS, HEX7_CLUSTER_BEARING + i * 60)
		);
	}

	return clusterCenters.flatMap(ring).map(([lon, lat]) => new Coords(lat, lon));
}
