<script lang="ts">
	import Button from "@/components/ui/input/Button.svelte";
	import IconValue from "@/components/ui/popups/common/IconValue.svelte";
	import { isSearchViewActive } from "@/lib/features/activeSearch.svelte";
	import {
		getFollowMeActive,
		getFollowMeStatus,
		getFollowMeSummary,
		stopFollowMe
	} from "@/lib/features/followMe/followMe.svelte.js";
	import * as m from "@/lib/paraglide/messages";
	import { LocateFixed, LocateOff } from "@lucide/svelte";
	import { fade } from "svelte/transition";

	// Follow-me keeps running with every menu closed, so without this the only
	// sign it is on is a row two taps away - which is how a beta tester ended
	// up unable to tell whether a scan had run, or whether it was still paused.
	let paused = $derived(getFollowMeStatus() === "too-fast");
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
				<span class="whitespace-nowrap">{getFollowMeSummary()}</span>
			</IconValue>
		</Button>
	</div>
{/if}
