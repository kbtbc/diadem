<script lang="ts">
	import Button from "@/components/ui/input/Button.svelte";
	import IconValue from "@/components/ui/popups/common/IconValue.svelte";
	import { isSearchViewActive } from "@/lib/features/activeSearch.svelte";
	import {
		getFollowMeActive,
		getFollowMeChipLabel,
		getFollowMeStatus,
		recenterFollowMe,
		restoreFollowMe,
		stopFollowMe
	} from "@/lib/features/followMe/followMe.svelte.js";
	import { getIsCameraFollowing } from "@/lib/map/geolocate.svelte";
	import { onMount } from "svelte";
	import * as m from "@/lib/paraglide/messages";
	import { Locate, LocateFixed, LocateOff } from "@lucide/svelte";
	import { fade } from "svelte/transition";

	// Follow-me keeps running with every menu closed, so without this the only
	// sign it is on is a row two taps away - which is how a beta tester ended
	// up unable to tell whether a scan had run, or whether it was still paused.
	let paused = $derived(getFollowMeStatus() === "too-fast");

	// Panning drops the camera, and then the chip's job changes: it offers the
	// camera back rather than offering to stop. One tap doing two different
	// things on invisible state is a trap, so the label says which one it is.
	let detached = $derived(getFollowMeActive() && !getIsCameraFollowing());

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
			onclick={detached ? recenterFollowMe : stopFollowMe}
			title={detached ? m.followme_chip_recenter_title() : m.followme_chip_stop()}
		>
			<IconValue
				Icon={detached ? Locate : paused ? LocateOff : LocateFixed}
				class={paused && !detached ? "opacity-70" : ""}
			>
				<span class="whitespace-nowrap">
					{detached ? m.followme_chip_recenter() : getFollowMeChipLabel()}
				</span>
			</IconValue>
		</Button>
	</div>
{/if}
