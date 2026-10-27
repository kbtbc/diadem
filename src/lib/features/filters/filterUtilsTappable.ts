import type {
	FiltersetTappable,
	FiltersetTitle,
	QuestReward
} from "@/lib/features/filters/filtersets";
import { setFilterIcon } from "@/lib/features/filters/filtersetUtils.svelte";
import { IconCategory } from "@/lib/features/filters/icons";
import {
	makeAttributePokemonLabel,
	makeAttributeRewardPokemonLabel
} from "@/lib/features/filters/makeAttributeChipLabel";
import { getActiveTappables } from "@/lib/features/masterStats.svelte";
import * as m from "@/lib/paraglide/messages";
import { mItem } from "@/lib/services/ingameLocale";
import { getId } from "@/lib/utils/uuid";

// Always offered as premade filters, first in their group, even when not on the map right now.
const PREMADE_POKEMON_IDS = [94];
const PREMADE_ITEM_IDS = [1301];

export function makeTappableItemLabel(items: QuestReward[]) {
	if (items.length === 1) return mItem(items[0].id);

	return m.count_items({ count: items.length });
}

export function generateTappableFilterDetails(filter: FiltersetTappable): FiltersetTappable {
	const title: FiltersetTitle = {
		title: filter.title.title,
		message: "filter_template_tappable_fallback"
	};
	setFilterIcon(filter, { emoji: "🎁" });

	const parts: string[] = [];
	let iconSet = false;

	function setIconOnce(options: Parameters<typeof setFilterIcon>[1]) {
		if (!iconSet) {
			setFilterIcon(filter, options);
			iconSet = true;
		}
	}

	if (filter.pokemon?.length) {
		parts.push(makeAttributePokemonLabel(filter.pokemon));
		setIconOnce({ uicon: { category: IconCategory.POKEMON, params: filter.pokemon[0] } });
	}

	if (filter.item?.length) {
		parts.push(makeTappableItemLabel(filter.item));
		setIconOnce({
			uicon: {
				category: IconCategory.ITEM,
				params: { item: Number(filter.item[0].id), amount: 0 }
			}
		});
	}

	if (filter.candy?.length) {
		parts.push(m.pokemon_candy({ pokemon: makeAttributeRewardPokemonLabel(filter.candy) }));
		setIconOnce({
			uicon: {
				category: IconCategory.MISC,
				params: { misc_type: "candy", pokemon_id: Number(filter.candy[0].id) }
			}
		});
	}

	if (parts.length > 0) {
		title.message = "filter_template_tappable_reward";
		title.params = { reward: parts.join(", ") };
	}

	filter.title = title;
	return filter;
}

function tappableFilterset(
	attributes: Partial<Pick<FiltersetTappable, "pokemon" | "item" | "candy">>
): FiltersetTappable {
	const filterset: FiltersetTappable = {
		id: getId(),
		icon: { isUserSelected: false },
		title: { message: "filter_template_tappable_fallback" },
		enabled: true,
		...attributes
	};

	return generateTappableFilterDetails(filterset);
}

export function getPremadeTappableFiltersets(): FiltersetTappable[] {
	const active = getActiveTappables();
	const filters: FiltersetTappable[] = [];
	const premadePokemonIds = new Set(PREMADE_POKEMON_IDS);
	const premadeItemIds = new Set(PREMADE_ITEM_IDS);

	for (const pokemonId of PREMADE_POKEMON_IDS) {
		filters.push(tappableFilterset({ pokemon: [{ pokemon_id: pokemonId, form: 0 }] }));
	}

	// Rarest first, like the quest premades.
	for (const entry of [...active.pokemon].sort((a, b) => a.count - b.count)) {
		if (premadePokemonIds.has(entry.id)) continue;
		filters.push(tappableFilterset({ pokemon: [{ pokemon_id: entry.id, form: 0 }] }));
	}

	for (const itemId of PREMADE_ITEM_IDS) {
		filters.push(tappableFilterset({ item: [{ id: String(itemId) }] }));
	}

	for (const entry of active.item) {
		if (premadeItemIds.has(entry.id)) continue;
		filters.push(tappableFilterset({ item: [{ id: String(entry.id) }] }));
	}

	for (const entry of active.candy) {
		filters.push(tappableFilterset({ candy: [{ id: String(entry.id) }] }));
	}

	return filters;
}
