import type { FiltersetTappable, FiltersetTitle } from "@/lib/features/filters/filtersets";
import { setFilterIcon } from "@/lib/features/filters/filtersetUtils.svelte";
import { IconCategory } from "@/lib/features/filters/icons";
import { mPokemon } from "@/lib/services/ingameLocale";

export function generateTappableFilterDetails(filter: FiltersetTappable): FiltersetTappable {
	const title: FiltersetTitle = {
		title: filter.title.title,
		message: "filter_template_tappable_fallback"
	};

	if (filter.pokemon && filter.pokemon.length > 0) {
		if (filter.pokemon.length === 1) {
			title.message = "filter_template_pokemon_tappables";
			title.params = {
				pokemon: mPokemon({ pokemon_id: filter.pokemon[0].pokemon_id, form: filter.pokemon[0].form })
			};
		} else {
			title.message = "count_pokemon";
			title.params = { count: filter.pokemon.length.toString() };
		}

		setFilterIcon(filter, {
			uicon: { category: IconCategory.POKEMON, params: filter.pokemon[0] }
		});
	}

	filter.title = title;
	return filter;
}
