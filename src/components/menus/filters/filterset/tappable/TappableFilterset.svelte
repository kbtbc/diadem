<script lang="ts">
	import FiltersetModal from "@/components/menus/filters/filterset/FiltersetModal.svelte";
	import AttributeChip from "@/components/menus/filters/filterset/AttributeChip.svelte";
	import Attribute from "@/components/menus/filters/filterset/Attribute.svelte";
	import AttributesOverview from "@/components/menus/filters/filterset/AttributesOverview.svelte";
	import PokemonSelectPage from "@/components/menus/filters/filterset/multiselect/PokemonSelectPage.svelte";
	import TappableRewardSelectPage from "@/components/menus/filters/filterset/tappable/TappableRewardSelectPage.svelte";
	import TappableFilterDisplay from "@/components/menus/filters/filterset/tappable/TappableFilterDisplay.svelte";
	import * as m from "@/lib/paraglide/messages";
	import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
	import { getCurrentSelectedFilterset } from "@/lib/features/filters/filtersetPageData.svelte";
	import {
		makeAttributePokemonLabel,
		makeAttributeRewardPokemonLabel
	} from "@/lib/features/filters/makeAttributeChipLabel";
	import { makeTappableItemLabel } from "@/lib/features/filters/filterUtilsTappable";
	import { getActiveTappables, getSpawnablePokemon } from "@/lib/features/masterStats.svelte";
	import { MapObjectType } from "@/lib/mapObjects/mapObjectTypes";
	import { RewardType, rewardTypeLabel } from "@/lib/utils/pokestopUtils";

	let data: FiltersetTappable | undefined = $derived(getCurrentSelectedFilterset()?.data) as
		FiltersetTappable | undefined;

	const active = $derived(getActiveTappables());

	// Only offer what is currently on the map. Without stats yet, fall back to every species.
	const pokemonList = $derived(
		active.pokemon.length > 0
			? active.pokemon.map((p) => ({ pokemon_id: p.id, form: 0 }))
			: getSpawnablePokemon()
	);
</script>

<FiltersetModal
	modalType="filtersetTappable"
	mapObject={MapObjectType.TAPPABLE}
	majorCategory="tappable"
	titleBase={m.tappable_filter()}
	titleShared={m.shared_tappable_filter()}
	titleNew={m.new_tappable_filter()}
	titleEdit={m.edit_tappable_filter()}
>
	{#snippet base()}
		{#if data}
			<TappableFilterDisplay {data} />
		{/if}
	{/snippet}
	{#snippet overview()}
		{#if data}
			<AttributesOverview>
				{#if pokemonList.length > 0 || data.pokemon}
					<Attribute label={m.species()}>
						<AttributeChip
							label={makeAttributePokemonLabel(data.pokemon ?? [])}
							isEmpty={!data.pokemon}
							onremove={() => delete data.pokemon}
						/>
						{#snippet page(thisData: FiltersetTappable)}
							<PokemonSelectPage data={thisData} attribute="pokemon" {pokemonList} />
						{/snippet}
					</Attribute>
				{/if}

				{#if active.item.length > 0 || data.item}
					<Attribute label={rewardTypeLabel(RewardType.ITEM)}>
						<AttributeChip
							label={makeTappableItemLabel(data.item ?? [])}
							isEmpty={!data.item}
							onremove={() => delete data.item}
						/>
						{#snippet page(thisData: FiltersetTappable)}
							<TappableRewardSelectPage data={thisData} attribute="item" />
						{/snippet}
					</Attribute>
				{/if}

				{#if active.candy.length > 0 || data.candy}
					<Attribute label={rewardTypeLabel(RewardType.CANDY)}>
						<AttributeChip
							label={makeAttributeRewardPokemonLabel(data.candy ?? [])}
							isEmpty={!data.candy}
							onremove={() => delete data.candy}
						/>
						{#snippet page(thisData: FiltersetTappable)}
							<TappableRewardSelectPage data={thisData} attribute="candy" />
						{/snippet}
					</Attribute>
				{/if}
			</AttributesOverview>
		{/if}
	{/snippet}
</FiltersetModal>
