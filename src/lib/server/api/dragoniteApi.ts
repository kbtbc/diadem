import { getServerConfig } from "@/lib/services/config/config.server";
import type { Feature, Polygon } from "geojson";
import { getLogger } from "@/lib/utils/logger";

const log = getLogger("dragonite");

function getHeaders() {
	const headers: HeadersInit = {
		"Content-Type": "application/json"
	};
	if (getServerConfig().dragonite.secret) {
		headers["X-Dragonite-Admin-Secret"] = getServerConfig().dragonite.secret ?? "";
	}
	if (getServerConfig().dragonite.basicAuth) {
		headers["Authorization"] = `Basic ${btoa(getServerConfig().dragonite.basicAuth ?? "")}`;
	}
	return headers;
}

export async function addScoutEntries(username: string, locations: number[][]) {
	const url = new URL("scout/v2", getServerConfig().dragonite.url);

	// Everything a scout is asked for costs time at the location, so all three
	// extras are switchable and only pokemon is fixed on. Routes default off:
	// they are static, and follow-me rescans the same user every 90 seconds, so
	// asking each time was paying repeatedly for one answer.
	const scout = getServerConfig().scout;
	const requestData = {
		username,
		locations,
		options: {
			routes: scout?.routes ?? false,
			showcases: scout?.showcases ?? true,
			pokemon: true,
			gmf: scout?.forts ?? true
		}
	};

	const response = await fetch(url, {
		headers: getHeaders(),
		method: "POST",
		body: JSON.stringify(requestData)
	});

	if (!response.ok) {
		log.error("Error while queueing scout entry [%d] %s", response.status, await response.text());
	}

	return response.ok;
}

export type DragoniteArea = {
	name: string;
	enabled: boolean;
	enablePokemon: boolean;
	pokemonWorkers: number;
	geofence: Feature<Polygon> | undefined;
};

/**
 * Areas as Dragonite's own area store has them, with their geofences.
 *
 * /v2/areas/ is the authoritative list: checked against the area table, it
 * matched row for row. /status is not - it reports the running worker
 * managers, which had drifted from the store in both directions, and it
 * carries no mode information at all.
 *
 * per_page defaults to 50, so the whole set has to be asked for; 1000 is the
 * API's maximum and there are 56 areas today.
 */
export async function getDragoniteAreas(): Promise<DragoniteArea[] | undefined> {
	const url = new URL("v2/areas/", getServerConfig().dragonite.url);
	url.searchParams.set("per_page", "1000");

	const response = await fetch(url, { headers: getHeaders() });

	if (!response.ok) {
		log.error("Error while getting dragonite areas [%d]", response.status);
		return undefined;
	}

	const data = (await response.json()) as {
		name: string;
		enabled?: boolean;
		enable_pokemon?: boolean;
		pokemon_mode?: { workers?: number };
		geofence?: Feature<Polygon>;
	}[];

	return data.map((area) => ({
		name: area.name,
		enabled: Boolean(area.enabled),
		enablePokemon: Boolean(area.enable_pokemon),
		pokemonWorkers: area.pokemon_mode?.workers ?? 0,
		geofence: area.geofence
	}));
}

export async function getScoutQueue(): Promise<number | undefined> {
	const url = new URL("scout/queue", getServerConfig().dragonite.url);
	const response = await fetch(url, { headers: getHeaders() });

	if (response.ok) {
		const data = await response.json();
		return data?.queue ?? undefined;
	} else {
		log.error(
			"Error while getting scout queue size [%d] %s",
			response.status,
			await response.text()
		);
	}
}
