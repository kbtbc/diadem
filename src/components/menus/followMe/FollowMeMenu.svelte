<script lang="ts">
	import * as m from "@/lib/paraglide/messages";
	import Card from "@/components/ui/Card.svelte";
	import MenuTitle from "@/components/menus/MenuTitle.svelte";
	import Button from "@/components/ui/input/Button.svelte";
	import {
		FOLLOW_ME_MAX_SPEED_KMH,
		getFollowMeActive,
		getFollowMeScanCount,
		getFollowMeSpeedKmh,
		getFollowMeStatus,
		toggleFollowMe,
		type FollowMeStatus
	} from "@/lib/features/followMe/followMe.svelte.js";

	// Deliberately no onDestroy stop: closing the menu must not end the
	// session, since the point is to keep scanning while the user plays.
	const statusText: Record<FollowMeStatus, () => string> = {
		off: m.followme_status_off,
		locating: m.followme_status_locating,
		scanning: m.followme_status_scanning,
		idle: m.followme_status_idle,
		"too-fast": m.followme_status_too_fast,
		covered: m.followme_status_covered,
		quota: m.followme_status_quota,
		busy: m.followme_status_busy,
		error: m.followme_status_error
	};

	let speed = $derived(getFollowMeSpeedKmh());
	let scans = $derived(getFollowMeScanCount());
</script>

<Card class="py-4 px-2">
	<div class="flex flex-col gap-2">
		<MenuTitle title={m.followme_title()} />
		<p class="px-2 text-sm opacity-80">{m.followme_description()}</p>
	</div>

	<div class="my-2 w-full text-center text-sm">
		<p>{statusText[getFollowMeStatus()]()}</p>
		{#if speed !== undefined}
			<p class="opacity-70">
				{m.followme_speed({ speed: speed.toFixed(1), limit: FOLLOW_ME_MAX_SPEED_KMH })}
			</p>
		{/if}
		{#if scans > 0}
			<p class="opacity-70">{m.followme_scans({ count: scans })}</p>
		{/if}
	</div>

	<Button variant="default" size="lg" class="w-full" onclick={toggleFollowMe}>
		{getFollowMeActive() ? m.followme_stop() : m.followme_start()}
	</Button>
</Card>
