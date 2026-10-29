<script lang="ts">
	import type { Component, Snippet } from "svelte";
	import type { LucideIcon } from "@/lib/types/lucide";

	let {
		Icon,
		children,
		class: class_ = "",
		iconClass = ""
	}: {
		Icon: LucideIcon | Component;
		children: Snippet;
		/** Goes on the row. Anything that should not also affect the text wants iconClass. */
		class?: string;
		/** Goes on the icon alone - a spin here rotates the icon, not the label with it. */
		iconClass?: string;
	} = $props();
</script>

<div class="flex {class_}">
	<Icon class="shrink-0 size-4 mt-1 {iconClass}" />

	<div class="ml-1.5">
		{@render children()}
	</div>
</div>
