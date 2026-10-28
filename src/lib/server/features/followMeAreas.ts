import { getDragoniteAreas } from "@/lib/server/api/dragoniteApi";
import { fetchKojiGeofences } from "@/lib/server/api/kojiApi";
import { getServerConfig } from "@/lib/services/config/config.server";
import type { KojiFeature } from "@/lib/features/koji";
import type { Coords } from "@/lib/utils/coordinates";
import { getLogger } from "@/lib/utils/logger";
import { booleanPointInPolygon } from "@turf/turf";

const log = getLogger("followme");

/**
 * Enabled Dragonite areas that run workers but have no pokemon coverage, so a
 * follow-me user standing in one still sees nothing and should be scanned.
 *
 * /status reports no mode per worker manager, so this cannot be derived from
 * the API - these three are fort-only (verified against dragonite.area,
 * 2026-10-28). Override with [server.followMe] uncoveredAreas.
 */
const DEFAULT_UNCOVERED_AREAS = ["GA-ATL-FORTS", "MO-STL", "TX-Austin-Fort"];

const CACHE_MS = 5 * 60_000;

let cache: { at: number; polygons: KojiFeature[] } | undefined = undefined;

async function getCoveredPolygons(thisFetch: typeof fetch): Promise<KojiFeature[] | undefined> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.polygons;

	const [geofences, areas] = await Promise.all([
		fetchKojiGeofences(thisFetch),
		getDragoniteAreas()
	]);
	if (!geofences || !areas) return undefined;

	const config = getServerConfig().followMe;
	const uncovered = new Set(config?.uncoveredAreas ?? DEFAULT_UNCOVERED_AREAS);

	// Worker counts are deliberately not consulted. Every enabled area had
	// workers when this was measured, so the condition bought nothing, and an
	// area sitting at zero workers for a moment is still an area we cover.
	const covered = new Set(
		[
			...areas.filter((area) => area.enabled).map((area) => area.name),
			...(config?.coveredAreas ?? [])
		].filter((name) => !uncovered.has(name))
	);

	// Raw Koji names deliberately: kojiRules hides and renames areas for the
	// coverage menu only, and an area hidden from that menu is still scanned.
	const polygons = geofences.filter((feature) => covered.has(feature.properties.name));

	log.debug(
		"Follow-me coverage: %d covered areas of %d geofences",
		polygons.length,
		geofences.length
	);
	cache = { at: Date.now(), polygons };
	return polygons;
}

/**
 * Whether a follow-me scan would overlap ground we already cover.
 *
 * Returns undefined when coverage cannot be determined - the caller backs off
 * rather than guessing, because guessing wrong spends 49 scouts.
 *
 * "overlap" (the default) skips the scan if any of its 49 points falls inside a
 * covered area, so no scout is spent on covered ground. "center" skips only
 * when the user themselves stands inside one, which scans the fringes of our
 * areas at the cost of some duplicated points.
 */
export async function overlapsCoveredArea(
	points: Coords[],
	thisFetch: typeof fetch
): Promise<boolean | undefined> {
	const polygons = await getCoveredPolygons(thisFetch);
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
