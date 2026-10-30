import { describe, expect, it } from "vitest";
import type { FilterPokemon } from "@/lib/features/filters/filters";
import { dropRetiredPersonalShinyFiltersets } from "@/lib/features/filters/retiredPersonalShiny";

function pokemonFilter(filters: object[]): FilterPokemon {
	return { category: "pokemon", enabled: true, filters: filters as FilterPokemon["filters"] };
}

describe("dropRetiredPersonalShinyFiltersets", () => {
	it("drops personal shiny filtersets and keeps the rest in order", () => {
		const pokemon = pokemonFilter([
			{ id: "a", title: { message: "Hundo" } },
			{ id: "b", personalShiny: true, personalShinyTrainers: ["t1"] },
			{ id: "c", title: { message: "Nundo" } }
		]);
		dropRetiredPersonalShinyFiltersets(pokemon);
		expect(pokemon.filters.map((f) => (f as { id?: string }).id)).toEqual(["a", "c"]);
	});

	it("strips a leftover trainer list from filtersets that stay", () => {
		const pokemon = pokemonFilter([{ id: "a", personalShinyTrainers: [] }]);
		dropRetiredPersonalShinyFiltersets(pokemon);
		expect("personalShinyTrainers" in pokemon.filters[0]).toBe(false);
	});

	it("ignores missing or malformed pokemon filters", () => {
		expect(() => dropRetiredPersonalShinyFiltersets(undefined)).not.toThrow();
		const broken = { category: "pokemon", enabled: true } as FilterPokemon;
		expect(() => dropRetiredPersonalShinyFiltersets(broken)).not.toThrow();
	});
});
