<script lang="ts">
	import FiltersetModal from "@/components/menus/filters/filterset/FiltersetModal.svelte";
	import AttributeChip from "@/components/menus/filters/filterset/AttributeChip.svelte";
	import Attribute from "@/components/menus/filters/filterset/Attribute.svelte";
	import AttributesOverview from "@/components/menus/filters/filterset/AttributesOverview.svelte";
	import PokemonSelectPage from "@/components/menus/filters/filterset/multiselect/PokemonSelectPage.svelte";
	import TappableFilterDisplay from "@/components/menus/filters/filterset/tappable/TappableFilterDisplay.svelte";
	import * as m from "@/lib/paraglide/messages";
	import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
	import { getCurrentSelectedFilterset } from "@/lib/features/filters/filtersetPageData.svelte";
	import { makeAttributePokemonLabel } from "@/lib/features/filters/makeAttributeChipLabel";
	import { getSpawnablePokemon } from "@/lib/features/masterStats.svelte";
	import { MapObjectType } from "@/lib/mapObjects/mapObjectTypes";

	let data: FiltersetTappable | undefined = $derived(getCurrentSelectedFilterset()?.data) as
		FiltersetTappable | undefined;
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
				<Attribute label={m.species()}>
					<AttributeChip
						label={makeAttributePokemonLabel(data.pokemon ?? [])}
						isEmpty={!data.pokemon}
						onremove={() => delete data.pokemon}
					/>
					{#snippet page(thisData: FiltersetTappable)}
						<PokemonSelectPage
							data={thisData}
							attribute="pokemon"
							pokemonList={getSpawnablePokemon()}
						/>
					{/snippet}
				</Attribute>
			</AttributesOverview>
		{/if}
	{/snippet}
</FiltersetModal>
