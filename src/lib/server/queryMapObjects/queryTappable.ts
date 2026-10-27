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

		const clauses: string[] = [];
		const values: unknown[] = [];
		const placeholders = (ids: number[]) => ids.map(() => "?").join(",");

		for (const filterset of filtersets) {
			const pokemon = [...new Set((filterset.pokemon ?? []).map((p) => p.pokemon_id))];
			const items = [...new Set((filterset.item ?? []).map((i) => Number(i.id)))];
			const candy = [...new Set((filterset.candy ?? []).map((c) => Number(c.id)))];

			// A filterset without any reward attribute matches every tappable.
			if (!pokemon.length && !items.length && !candy.length) return { sql: "", values: [] };

			// A tappable gives one kind of reward, so the attributes are alternatives.
			if (pokemon.length) {
				clauses.push(`pokemon_id IN (${placeholders(pokemon)})`);
				values.push(...pokemon);
			}
			if (items.length) {
				clauses.push(`item_id IN (${placeholders(items)})`);
				values.push(...items);
			}
			if (candy.length) {
				clauses.push(`(reward_type = 'pokemon_candy' AND reward_pokemon_id IN (${placeholders(candy)}))`);
				values.push(...candy);
			}
		}

		return { sql: `(${clauses.join(" OR ")})`, values };
	}
}
