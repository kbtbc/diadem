<script lang="ts">
	import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
	import PokemonDisplay from "@/components/menus/filters/filterset/display/PokemonDisplay.svelte";
	import FilterDisplay from "@/components/menus/filters/filterset/display/FilterDisplay.svelte";
	import HorizontalScrollDisplay from "@/components/menus/filters/filterset/display/HorizontalScrollDisplay.svelte";
	import HorizontalScrollElement from "@/components/menus/filters/filterset/display/HorizontalScrollElement.svelte";
	import { resize } from "@/lib/services/assets";
	import { getIconReward } from "@/lib/services/uicons.svelte";
	import { mItem, mPokemon } from "@/lib/services/ingameLocale";
	import { RewardType, rewardTypeLabel } from "@/lib/utils/pokestopUtils";
	import * as m from "@/lib/paraglide/messages";

	let {
		data
	}: {
		data: FiltersetTappable;
	} = $props();
</script>

<FilterDisplay>
	{#if data.pokemon}
		<PokemonDisplay label={m.species()} pokemon={data.pokemon} />
	{/if}

	{#if data.item}
		<HorizontalScrollDisplay label={rewardTypeLabel(RewardType.ITEM)}>
			{#each data.item as item (item.id)}
				{@const name = mItem(item.id)}
				<HorizontalScrollElement>
					<img
						class="w-7"
						src={resize(getIconReward(RewardType.ITEM, { item_id: Number(item.id) }), { width: 64 })}
						alt={name}
					/>
					{name}
				</HorizontalScrollElement>
			{/each}
		</HorizontalScrollDisplay>
	{/if}

	{#if data.candy}
		<HorizontalScrollDisplay label={rewardTypeLabel(RewardType.CANDY)}>
			{#each data.candy as candy (candy.id)}
				{@const name = m.pokemon_candy({
					pokemon: mPokemon({ pokemon_id: Number(candy.id), form: 0 })
				})}
				<HorizontalScrollElement>
					<img
						class="w-7"
						src={resize(getIconReward(RewardType.CANDY, { pokemon_id: Number(candy.id) }), {
							width: 64
						})}
						alt={name}
					/>
					{name}
				</HorizontalScrollElement>
			{/each}
		</HorizontalScrollDisplay>
	{/if}
</FilterDisplay>
