import type { FilterTappable } from "@/lib/features/filters/filters";
import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
import { TappableQuery } from "@/lib/server/queryMapObjects/queryTappable";
import { describe, expect, it } from "vitest";

function filterset(overrides: Partial<FiltersetTappable> = {}): FiltersetTappable {
	return {
		id: "id",
		title: { message: "unknown_filter" },
		icon: { isUserSelected: false },
		enabled: true,
		...overrides
	};
}

function filter(filters: FiltersetTappable[], enabled = true): FilterTappable {
	return { category: "tappable", enabled, filters } as FilterTappable;
}

function where(f: FilterTappable | undefined) {
	const query = new TappableQuery() as unknown as {
		getFilterWhere(f: FilterTappable | undefined): { sql: string; values: unknown[] };
	};
	return query.getFilterWhere(f);
}

describe("TappableQuery.getFilterWhere", () => {
	it("adds no restriction without filtersets or filter", () => {
		expect(where(undefined)).toEqual({ sql: "", values: [] });
		expect(where(filter([]))).toEqual({ sql: "", values: [] });
		expect(where(filter([filterset({ pokemon: [{ pokemon_id: 1, form: 0 }] })], false))).toEqual({
			sql: "",
			values: []
		});
	});

	it("restricts to the selected species across enabled filtersets", () => {
		const result = where(
			filter([
				filterset({ pokemon: [{ pokemon_id: 25, form: 0 }, { pokemon_id: 1, form: 0 }] }),
				filterset({ pokemon: [{ pokemon_id: 25, form: 0 }] }),
				filterset({ enabled: false, pokemon: [{ pokemon_id: 999, form: 0 }] })
			])
		);
		expect(result).toEqual({ sql: "pokemon_id IN (?,?)", values: [25, 1] });
	});

	it("does not restrict when any enabled filterset has no species", () => {
		expect(
			where(filter([filterset({ pokemon: [{ pokemon_id: 25, form: 0 }] }), filterset()]))
		).toEqual({ sql: "", values: [] });
	});
});
