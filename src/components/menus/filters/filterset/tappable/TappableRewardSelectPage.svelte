<script lang="ts">
	import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
	import { getActiveTappables } from "@/lib/features/masterStats.svelte";
	import { RewardType } from "@/lib/utils/pokestopUtils";
	import * as m from "@/lib/paraglide/messages";
	import { mItem, mPokemon } from "@/lib/services/ingameLocale";
	import { getIconReward } from "@/lib/services/uicons.svelte";
	import { resize } from "@/lib/services/assets";
	import MultiSelect from "@/components/menus/filters/filterset/multiselect/MultiSelect.svelte";
	import MultiSelectItem from "@/components/menus/filters/filterset/multiselect/MultiSelectItem.svelte";

	let {
		data,
		attribute
	}: {
		data: FiltersetTappable;
		attribute: "item" | "candy";
	} = $props();

	// What is on the map now, plus anything already selected so it can still be removed.
	const options = $derived.by(() => {
		const ids = new Set<number>(getActiveTappables()[attribute].map((e) => e.id));
		for (const reward of data[attribute] ?? []) ids.add(Number(reward.id));

		return [...ids]
			.sort((a, b) => a - b)
			.map((id) =>
				attribute === "item"
					? {
							id: String(id),
							name: mItem(id),
							icon: getIconReward(RewardType.ITEM, { item_id: id })
						}
					: {
							id: String(id),
							name: m.pokemon_candy({ pokemon: mPokemon({ pokemon_id: id, form: 0 }) }),
							icon: getIconReward(RewardType.CANDY, { pokemon_id: id })
						}
			);
	});

	function isSelected(id: string) {
		return data[attribute]?.some((r) => r.id === id) ?? false;
	}

	function onselect(id: string, selected: boolean) {
		if (selected) {
			if (!data[attribute]) data[attribute] = [];
			data[attribute]!.push({ id });
		} else {
			data[attribute] = data[attribute]?.filter((r) => r.id !== id);
		}

		if (data[attribute]?.length === 0) delete data[attribute];
	}
</script>

{#if options.length > 0}
	<MultiSelect>
		{#each options as option (option.id)}
			<MultiSelectItem
				isSelected={isSelected(option.id)}
				onclick={(value) => onselect(option.id, value)}
			>
				<img
					class="w-8"
					alt={option.name}
					src={resize(option.icon, { width: 64 })}
					loading="lazy"
				/>
				<div class="grow text-center align-middle flex items-center px-1">
					<span class="h-fit">
						{option.name}
					</span>
				</div>
			</MultiSelectItem>
		{/each}
	</MultiSelect>
{/if}
