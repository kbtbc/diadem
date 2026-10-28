import { getDragoniteAreas } from "@/lib/server/api/dragoniteApi";
import { getServerConfig } from "@/lib/services/config/config.server";
import type { Coords } from "@/lib/utils/coordinates";
import { getLogger } from "@/lib/utils/logger";
import { booleanPointInPolygon } from "@turf/turf";
import type { Feature, Polygon } from "geojson";

const log = getLogger("followme");

const CACHE_MS = 5 * 60_000;

type CoveredArea = { name: string; geofence: Feature<Polygon> };

/** Which area a scan ran into, so the refusal can name it. */
export type CoverageVerdict = { covered: false } | { covered: true; area: string };

let cache: { at: number; areas: CoveredArea[] } | undefined = undefined;

/**
 * The areas we already scan for pokemon, with their geofences.
 *
 * Both the list and the geofences come from Dragonite's own area store, so
 * there is nothing to match up by name. This used to cross Dragonite's
 * /status against Koji's geofences, which was wrong twice over: /status
 * reports running worker managers rather than the store, so it drifted from
 * the area table in both directions, and it says nothing about which mode an
 * area runs, which meant keeping a hand-written list of the fort-only ones.
 */
async function getCoveredAreas(): Promise<CoveredArea[] | undefined> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.areas;

	const all = await getDragoniteAreas();
	if (!all) return undefined;

	// The same three conditions the area table uses for "this ground is
	// covered for pokemon": enabled, pokemon mode on, and workers on it.
	const areas: CoveredArea[] = [];
	for (const area of all) {
		if (!area.enabled || !area.enablePokemon || area.pokemonWorkers <= 0) continue;
		if (!area.geofence) continue;
		areas.push({ name: area.name, geofence: area.geofence });
	}

	log.debug("Follow-me coverage: %d covered areas of %d", areas.length, all.length);
	cache = { at: Date.now(), areas };
	return areas;
}

/**
 * Whether a follow-me scan would overlap ground we already cover, and which
 * area it ran into - the caller logs that name, because "refused 40 times" and
 * "refused 40 times by one area whose geofence reaches too far" are different
 * problems.
 *
 * Returns undefined when coverage cannot be determined - the caller backs off
 * rather than guessing, because guessing wrong spends 49 scouts.
 *
 * "overlap" (the default) skips the scan if any of its 49 points falls inside
 * a covered area, so no scout is spent on covered ground. "center" skips only
 * when the user themselves stands inside one, which scans the fringes of our
 * areas at the cost of some duplicated points.
 */
export async function overlapsCoveredArea(points: Coords[]): Promise<CoverageVerdict | undefined> {
	const areas = await getCoveredAreas();
	if (!areas) return undefined;

	const mode = getServerConfig().followMe?.overlapMode ?? "overlap";
	const tested = mode === "center" ? points.slice(0, 1) : points;

	for (const point of tested) {
		const position = point.geojson();
		for (const area of areas) {
			if (booleanPointInPolygon(position, area.geofence)) {
				return { covered: true, area: area.name };
			}
		}
	}

	return { covered: false };
}

/** Test seam: drop the cached coverage set. */
export function resetCoveredAreaCache() {
	cache = undefined;
}
