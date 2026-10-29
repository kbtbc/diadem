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
		restoreFollowMe,
		stopFollowMe
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
	// map. Tapping the chip is not how you switch the feature off - that was a
	// tap meaning two different things on invisible state, and it caught the
	// tester out. Off is the button at the bottom of this panel, where it takes
	// a deliberate second tap, and in the Tools menu.
	let info: ReturnType<typeof getFollowMeSnapshot> | undefined = $state(undefined);

	// A chip reading "Recenter" is a button that says what it does, so it had
	// better do it: opening a panel instead read as broken. The panel is one
	// more tap away, which is the right way round - a dropped camera is the
	// thing you want to fix in that moment.
	function onChipTap() {
		if (detached) {
			recenter();
			return;
		}
		info = info ? undefined : getFollowMeSnapshot();
	}

	function recenter() {
		recenterFollowMe();
		info = undefined;
	}

	function stop() {
		info = undefined;
		stopFollowMe();
	}

	/** The row labels carry the direction, so one "N min" string does both. */
	function sinceLabel(at: number, now: number): string {
		if (!at) return m.followme_info_none();
		const seconds = Math.round(Math.abs(now - at) / 1000);
		if (seconds < 60) return m.followme_info_just_now();
		return m.followme_info_minutes({ count: Math.round(seconds / 60) });
	}

	/**
	 * Rounded up, so the last 59 seconds of a cooldown read "1 min" rather than
	 * "due now" - a scan that cannot run yet should not claim to be due.
	 *
	 * Once the cooldown has passed there is no time to count down to: the scan
	 * waits on the user covering ground, so that is what it says. The
	 * five-minute ceiling will fire it eventually if they stay put, but
	 * movement is the part they control.
	 */
	function untilLabel(info: ReturnType<typeof getFollowMeSnapshot>): string {
		if (info.nextScanAt > info.now) {
			return m.followme_info_minutes({ count: Math.ceil((info.nextScanAt - info.now) / 60_000) });
		}
		return info.lastScanAt ? m.followme_info_on_move() : m.followme_info_due();
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
			onclick={onChipTap}
			title={detached ? m.followme_chip_recenter_title() : m.followme_chip_info_title()}
		>
			<IconValue
				Icon={scanning ? LoaderCircle : detached ? Locate : paused ? LocateOff : LocateFixed}
				class={paused && !detached ? "opacity-70" : ""}
				iconClass={scanning ? "animate-spin" : ""}
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
					<span class="whitespace-nowrap">{untilLabel(info)}</span>
				</div>
				<div class="flex justify-between gap-6">
					<span class="text-muted-foreground">{m.followme_info_scans_used()}</span>
					<!--
						The hourly allowance, which is a balance. It used to read
						"2 \u00b7 49" - scans so far, then the points in the last scan - and
						was read as two of forty-nine, a bank of something. This is the
						number that was being looked for.
					-->
					<span class="whitespace-nowrap">
						{info.scansPerHour
							? m.followme_info_of({ used: info.scansUsed, limit: info.scansPerHour })
							: info.scanCount}
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
				<Button
					variant="ghost"
					size=""
					class="mt-1 w-full px-2 py-1 text-xs border rounded-md text-destructive hover:bg-accent"
					onclick={stop}
				>
					{m.followme_info_stop()}
				</Button>
			</div>
		{/if}
	</div>
{/if}
