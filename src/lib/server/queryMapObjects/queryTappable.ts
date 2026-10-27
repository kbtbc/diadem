import type { FilterTappable } from "@/lib/features/filters/filters";
import { MapObjectType } from "@/lib/mapObjects/mapObjectTypes";
import { requestLimits } from "@/lib/server/api/rateLimit";
import { DbMapObjectQuery } from "@/lib/server/queryMapObjects/MapObjectQuery";
import type { TappableData } from "@/lib/types/mapObjectData/tappable";

export class TappableQuery extends DbMapObjectQuery<TappableData, FilterTappable> {
	protected readonly type = MapObjectType.TAPPABLE;
	protected readonly table = "tappable";
	protected readonly fields = [
		"id",
		"lat",
		"lon",
		"type as tappable_type",
		"pokemon_id",
		"item_id",
		"count",
		"expire_timestamp_verified",
		"expire_timestamp",
		"updated"
	];
	protected readonly limit = requestLimits[MapObjectType.TAPPABLE];
	protected readonly idColumn = "id";
	protected readonly extraWhere = ["expire_timestamp > UNIX_TIMESTAMP()"];

	protected getFilterWhere(filter: FilterTappable | undefined): { sql: string; values: unknown[] } {
		if (!filter?.enabled) return { sql: "", values: [] };

		const filtersets = filter.filters.filter((f) => f.enabled);
		if (filtersets.length === 0) return { sql: "", values: [] };

		// A filterset without a species list matches every tappable.
		if (filtersets.some((f) => !f.pokemon?.length)) return { sql: "", values: [] };

		const ids = new Set<number>();
		for (const filterset of filtersets) {
			for (const pokemon of filterset.pokemon ?? []) ids.add(pokemon.pokemon_id);
		}
		return { sql: `pokemon_id IN (${[...ids].map(() => "?").join(",")})`, values: [...ids] };
	}
}
