<script lang="ts">
	import type { FiltersetTappable } from "@/lib/features/filters/filtersets";
	import PokemonDisplay from "@/components/menus/filters/filterset/display/PokemonDisplay.svelte";
	import FilterDisplay from "@/components/menus/filters/filterset/display/FilterDisplay.svelte";
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
</FilterDisplay>
