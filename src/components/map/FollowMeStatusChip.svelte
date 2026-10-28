<script lang="ts">
	import Button from "@/components/ui/input/Button.svelte";
	import IconValue from "@/components/ui/popups/common/IconValue.svelte";
	import { isSearchViewActive } from "@/lib/features/activeSearch.svelte";
	import {
		getFollowMeActive,
		getFollowMeChipLabel,
		getFollowMeStatus,
		restoreFollowMe,
		stopFollowMe
	} from "@/lib/features/followMe/followMe.svelte.js";
	import { onMount } from "svelte";
	import * as m from "@/lib/paraglide/messages";
	import { LocateFixed, LocateOff } from "@lucide/svelte";
	import { fade } from "svelte/transition";

	// Follow-me keeps running with every menu closed, so without this the only
	// sign it is on is a row two taps away - which is how a beta tester ended
	// up unable to tell whether a scan had run, or whether it was still paused.
	let paused = $derived(getFollowMeStatus() === "too-fast");

	// This chip is mounted with the map whether or not follow-me is running, so
	// it is the natural place to pick a session back up after a reload. The
	// store guards against being called twice.
	onMount(() => restoreFollowMe());
</script>

{#if getFollowMeActive() && !isSearchViewActive()}
	<div class="pointer-events-none" transition:fade={{ duration: 90 }}>
		<Button
			variant="ghost"
			size=""
			class="pointer-events-auto px-3 py-2 text-sm bg-card border rounded-lg shadow-lg hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground"
			onclick={stopFollowMe}
			title={m.followme_chip_stop()}
		>
			<IconValue Icon={paused ? LocateOff : LocateFixed} class={paused ? "opacity-70" : ""}>
				<span class="whitespace-nowrap">{getFollowMeChipLabel()}</span>
			</IconValue>
		</Button>
	</div>
{/if}
