import { getDragoniteAreas } from "@/lib/server/api/dragoniteApi";
import { getServerConfig } from "@/lib/services/config/config.server";
import type { Coords } from "@/lib/utils/coordinates";
import { getLogger } from "@/lib/utils/logger";
import { booleanPointInPolygon } from "@turf/turf";
import type { Feature, Polygon } from "geojson";

const log = getLogger("followme");

const CACHE_MS = 5 * 60_000;

let cache: { at: number; polygons: Feature<Polygon>[] } | undefined = undefined;

/**
 * The areas we already scan for pokemon, as polygons.
 *
 * Both the list and the geofences come from Dragonite's own area store, so
 * there is nothing to match up by name. This used to cross Dragonite's
 * /status against Koji's geofences, which was wrong twice over: /status
 * reports running worker managers rather than the store, so it drifted from
 * the area table in both directions, and it says nothing about which mode an
 * area runs, which meant keeping a hand-written list of the fort-only ones.
 */
async function getCoveredPolygons(): Promise<Feature<Polygon>[] | undefined> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.polygons;

	const areas = await getDragoniteAreas();
	if (!areas) return undefined;

	// The same three conditions the area table uses for "this ground is
	// covered for pokemon": enabled, pokemon mode on, and workers on it.
	const polygons = areas
		.filter((area) => area.enabled && area.enablePokemon && area.pokemonWorkers > 0)
		.map((area) => area.geofence)
		.filter((geofence): geofence is Feature<Polygon> => Boolean(geofence));

	log.debug("Follow-me coverage: %d covered areas of %d", polygons.length, areas.length);
	cache = { at: Date.now(), polygons };
	return polygons;
}

/**
 * Whether a follow-me scan would overlap ground we already cover.
 *
 * Returns undefined when coverage cannot be determined - the caller backs off
 * rather than guessing, because guessing wrong spends 49 scouts.
 *
 * "overlap" (the default) skips the scan if any of its 49 points falls inside
 * a covered area, so no scout is spent on covered ground. "center" skips only
 * when the user themselves stands inside one, which scans the fringes of our
 * areas at the cost of some duplicated points.
 */
export async function overlapsCoveredArea(points: Coords[]): Promise<boolean | undefined> {
	const polygons = await getCoveredPolygons();
	if (!polygons) return undefined;

	const mode = getServerConfig().followMe?.overlapMode ?? "overlap";
	const tested = mode === "center" ? points.slice(0, 1) : points;

	for (const point of tested) {
		const position = point.geojson();
		for (const polygon of polygons) {
			if (booleanPointInPolygon(position, polygon)) return true;
		}
	}

	return false;
}

/** Test seam: drop the cached coverage set. */
export function resetCoveredAreaCache() {
	cache = undefined;
}
