import type { FilterPokemon } from "@/lib/features/filters/filters";

/**
 * Personal shiny hunting was retired (2026-10-29). Filtersets saved while it existed
 * carry a `personalShiny` flag nothing reads any more, so they would match every
 * pokemon. Drop them, and strip the leftover trainer list from anything else.
 */
export function dropRetiredPersonalShinyFiltersets(pokemon: FilterPokemon | undefined) {
	if (!pokemon || !Array.isArray(pokemon.filters)) return;
	pokemon.filters = pokemon.filters.filter(
		(filterset) => !(filterset as { personalShiny?: boolean }).personalShiny
	);
	for (const filterset of pokemon.filters) {
		delete (filterset as { personalShinyTrainers?: string[] }).personalShinyTrainers;
	}
}
