<script lang="ts">
	import Button from "@/components/ui/input/Button.svelte";
	import IconValue from "@/components/ui/popups/common/IconValue.svelte";
	import { isSearchViewActive } from "@/lib/features/activeSearch.svelte";
	import {
		getFollowMeActive,
		getFollowMeChipLabel,
		getFollowMeSnapshot,
		getFollowMeStatus,
		recenterFollowMe,
		restoreFollowMe
	} from "@/lib/features/followMe/followMe.svelte.js";
	import { getIsCameraFollowing } from "@/lib/map/geolocate.svelte";
	import { onMount } from "svelte";
	import * as m from "@/lib/paraglide/messages";
	import { Locate, LocateFixed, LoaderCircle, LocateOff } from "@lucide/svelte";
	import { fade } from "svelte/transition";

	// Follow-me keeps running with every menu closed, so without this the only
	// sign it is on is a row two taps away - which is how a beta tester ended
	// up unable to tell whether a scan had run, or whether it was still paused.
	let paused = $derived(getFollowMeStatus() === "too-fast");
	let scanning = $derived(getFollowMeStatus() === "scanning");

	// A pan lets go of the camera, and the chip says so rather than quietly
	// claiming to follow - which is exactly what it used to do.
	let detached = $derived(getFollowMeActive() && !getIsCameraFollowing());

	// Taken when the panel opens and never touched again: no timer runs over the
	// map. Tapping the chip is also no longer how you switch the feature off -
	// that was a tap meaning two different things on invisible state, and it
	// caught the tester out. Off lives in the Tools menu.
	let info: ReturnType<typeof getFollowMeSnapshot> | undefined = $state(undefined);

	function toggleInfo() {
		info = info ? undefined : getFollowMeSnapshot();
	}

	function recenter() {
		recenterFollowMe();
		info = undefined;
	}

	/** The row labels carry the direction, so one "N min" string does both. */
	function sinceLabel(at: number, now: number): string {
		if (!at) return m.followme_info_none();
		const seconds = Math.round(Math.abs(now - at) / 1000);
		if (seconds < 60) return m.followme_info_just_now();
		return m.followme_info_minutes({ count: Math.round(seconds / 60) });
	}

	function untilLabel(at: number, now: number): string {
		if (!at || at <= now) return m.followme_info_due();
		const minutes = Math.round((at - now) / 60_000);
		return minutes < 1 ? m.followme_info_due() : m.followme_info_minutes({ count: minutes });
	}

	// This chip is mounted with the map whether or not follow-me is running, so
	// it is the natural place to pick a session back up after a reload. The
	// store guards against being called twice.
	onMount(() => restoreFollowMe());
</script>

{#if getFollowMeActive() && !isSearchViewActive()}
	<div class="pointer-events-none flex flex-col items-end gap-1" transition:fade={{ duration: 90 }}>
		<Button
			variant="ghost"
			size=""
			class="pointer-events-auto px-3 py-2 text-sm bg-card border rounded-lg shadow-lg hover:bg-accent hover:text-accent-foreground active:bg-accent active:text-accent-foreground"
			onclick={toggleInfo}
			title={m.followme_chip_info_title()}
		>
			<IconValue
				Icon={scanning ? LoaderCircle : detached ? Locate : paused ? LocateOff : LocateFixed}
				class={scanning ? "animate-spin" : paused && !detached ? "opacity-70" : ""}
			>
				<span class="whitespace-nowrap">
					{detached ? m.followme_chip_recenter() : getFollowMeChipLabel()}
				</span>
			</IconValue>
		</Button>

		{#if info}
			<div
				class="pointer-events-auto bg-card border rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5"
			>
				<div class="flex justify-between gap-6">
					<span class="text-muted-foreground">{m.followme_info_last_scan()}</span>
					<span class="whitespace-nowrap">{sinceLabel(info.lastScanAt, info.now)}</span>
				</div>
				<div class="flex justify-between gap-6">
					<span class="text-muted-foreground">{m.followme_info_next_scan()}</span>
					<span class="whitespace-nowrap">{untilLabel(info.nextScanAt, info.now)}</span>
				</div>
				<div class="flex justify-between gap-6">
					<span class="text-muted-foreground">{m.followme_info_scans()}</span>
					<span class="whitespace-nowrap">
						{info.scanCount}{info.points ? " \u00b7 " + info.points : ""}
					</span>
				</div>
				{#if detached}
					<Button
						variant="ghost"
						size=""
						class="mt-1 w-full px-2 py-1 text-xs border rounded-md hover:bg-accent"
						onclick={recenter}
					>
						{m.followme_chip_recenter()}
					</Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
