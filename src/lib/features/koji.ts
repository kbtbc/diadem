import type { Feature, Polygon } from "geojson";
import { getConfig } from "@/lib/services/config/config";
import { displayAreaName, isAreaHidden } from "@/lib/features/kojiRules";
import { getHeaders, parseResponse } from "@/lib/utils/requests";

export type KojiReference = {
	id: number;
	name: string;
	parent: string | null;
};

type KojiProperties = {
	name: string;
	lucideIcon?: string;
	group?: string;
	children: KojiFeature[];
	parentName: string | null;
} & KojiReference;

export type KojiFeature = Feature<Polygon, KojiProperties>;
export type KojiFeatures = KojiFeature[];
let geofences: KojiFeatures = [];

export async function loadKojiGeofences() {
	const result = await fetch("/api/koji", { headers: getHeaders() });

	if (!result.ok) {
		// this also errors when koji is disabled by admin, but checking isSupportedFeature would race on initial loading
		console.error("Error while fetching geofences");
		return;
	}

	const rules = getConfig()?.coverage;
	const data = (await parseResponse<KojiFeatures>(result)).filter((a) => !isAreaHidden(a.properties.name, rules));

	const areaMap = new Map<string, KojiFeature>();
	data.forEach((a) => {
		areaMap.set(a.properties.name, a);
		a.properties.children = [];
	});

	data.forEach((area) => {
		if (!area.properties.parent) return;

		const parent = areaMap.get(area.properties.parent);
		if (parent) {
			parent.properties.children.push(area);
			area.properties.parentName = parent.properties.name;
		} else {
			area.properties.parentName = null;
		}
	});

	// Display names only, after the parent links above (which use the real names).
	data.forEach((area) => {
		area.properties.name = displayAreaName(area.properties.name, rules);
	});

	geofences = data;
}

export function getKojiGeofences() {
	return geofences;
}
