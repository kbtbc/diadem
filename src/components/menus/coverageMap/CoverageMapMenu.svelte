<script lang="ts">
	import { getKojiGeofences, type KojiFeature } from "@/lib/features/koji";
	import { compareAreaNames, groupByState } from "@/lib/features/coverageGroups";
	import Button from "@/components/ui/input/Button.svelte";
	import LucideIcon from "@/components/utils/LucideIcon.svelte";
	import { ChevronRight } from "@lucide/svelte";
	import { selectCoverageMapArea } from "@/lib/features/coverageMap.svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { slide } from "svelte/transition";
	import { hasLoadedFeature, LoadedFeature } from "@/lib/services/initialLoad.svelte";
	import { m } from "@/lib/paraglide/messages";
	import type * as icons from "@lucide/svelte";

	let expandedAreas: Set<number> = new SvelteSet();
	// State groups start collapsed except Georgia; codes in here are open.
	let expandedStates: Set<string> = new SvelteSet(["GA"]);

	function toggleState(code: string) {
		if (!expandedStates.delete(code)) expandedStates.add(code);
	}

	function getAreaIcon(area: KojiFeature): keyof typeof icons {
		return (area.properties.lucideIcon ?? "Globe") as keyof typeof icons;
	}
</script>

{#snippet areaTitle(area: KojiFeature)}
	<LucideIcon class="size-4 ml-2" name={getAreaIcon(area)} />
	<span>{area.properties.name}</span>
{/snippet}

{#snippet jumpButton(area: KojiFeature)}
	<Button
		class="ml-auto px-6"
		size="sm"
		variant="secondary"
		onclick={() => selectCoverageMapArea(area)}
	>
		{m.coveragemap_view()}
	</Button>
{/snippet}

{#snippet areaEntry(area: KojiFeature)}
	{@const isExpanded = expandedAreas.has(area.properties.id)}
	<div class="w-full flex py-2 items-center pl-2 pr-2 gap-3 text-sm font-medium">
		{#if area.properties.children.length === 0}
			{@render areaTitle(area)}
		{:else}
			<Button
				class="gap-3! pl-0!"
				size="sm"
				variant="ghost"
				onclick={() => {
					const existed = expandedAreas.delete(area.properties.id);
					if (!existed) expandedAreas.add(area.properties.id);
				}}
			>
				{@render areaTitle(area)}
				<ChevronRight
					size="16"
					class="transition-[rotate] mt-px"
					style="rotate: {isExpanded ? '90deg' : '0deg'}"
				/>
			</Button>
		{/if}

		{@render jumpButton(area)}
	</div>

	{#if isExpanded}
		<div class="pl-6" transition:slide={{ duration: 150 }}>
			{#each [...area.properties.children].sort(compareAreaNames) as child (child.properties.id)}
				<div class="w-full flex py-2 items-center pl-2 pr-2 gap-3 text-sm font-medium">
					{@render areaTitle(child)}
					{@render jumpButton(child)}
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

<div class="overflow-hidden">
	{#if hasLoadedFeature(LoadedFeature.KOJI)}
		{@const groups = groupByState(getKojiGeofences().filter((a) => !a.properties.parent))}
		{@const allOpen = groups.every((g) => expandedStates.has(g.code))}
		<div class="flex justify-end px-2 pt-2">
			<Button
				size="sm"
				variant="ghost"
				onclick={() => {
					if (allOpen) expandedStates.clear();
					else for (const g of groups) expandedStates.add(g.code);
				}}
			>
				{allOpen ? m.coveragemap_collapse_all() : m.coveragemap_expand_all()}
			</Button>
		</div>
		{#each groups as group (group.code)}
			{@const isOpen = expandedStates.has(group.code)}
			<h3 class="pt-2">
				<button
					type="button"
					class="w-full flex items-center gap-2 px-2 py-2 text-xs font-semibold uppercase tracking-wide opacity-70 hover:opacity-100 cursor-pointer"
					aria-expanded={isOpen}
					onclick={() => toggleState(group.code)}
				>
					<ChevronRight
						size="14"
						class="transition-[rotate]"
						style="rotate: {isOpen ? '90deg' : '0deg'}"
					/>
					{group.name}
					<span class="font-normal">({group.areas.length})</span>
				</button>
			</h3>
			{#if isOpen}
				<div transition:slide={{ duration: 150 }}>
					{#each group.areas as area (area.properties.id)}
						{@render areaEntry(area)}
					{/each}
				</div>
			{/if}
		{/each}
	{/if}
</div>
