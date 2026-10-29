<script lang="ts">
	import { Binoculars, Earth, LocateFixed, MapPin } from "@lucide/svelte";
	import { FillLayer, GeoJSON, LineLayer, MapLibre } from "svelte-maplibre";
	import ToolLink from "@/components/menus/tools/ToolLink.svelte";
	import { getCoverageMapAreas, openCoverageMap } from "@/lib/features/coverageMap.svelte";
	import { openWayfarerMap } from "@/lib/features/wayfarerMap.svelte";
	import { getConfig } from "@/lib/services/config/config";
	import { hasFeatureAnywhere } from "@/lib/services/user/checkPerm";
	import { getUserDetails } from "@/lib/services/user/userDetails.svelte";
	import { Features } from "@/lib/utils/features";
	import { isSupportedFeature } from "@/lib/services/supportedFeatures";
	import {
		getCoords,
		getScoutGeojsons,
		setCurrentScoutCenter,
		setCurrentScoutCoords
	} from "@/lib/features/scout.svelte";
	import { Menu, openMenu, setJustChangedMenus } from "@/lib/ui/menus.svelte";
	import {
		getFollowMeNotice,
		getFollowMeSummary,
		toggleFollowMe
	} from "@/lib/features/followMe/followMe.svelte";
	import Card from "@/components/ui/Card.svelte";
	import Switch from "@/components/ui/input/Switch.svelte";
	import { getUserSettings, updateUserSettings } from "@/lib/services/userSettings.svelte";
	import { getMap } from "@/lib/map/map.svelte";
	import { Coords } from "@/lib/utils/coordinates";
	import { getDefaultMapStyle } from "@/lib/services/themeMode";
	import { featureCollection } from "@turf/turf";
	import * as m from "@/lib/paraglide/messages";
</script>

<div class="space-y-2">
	{#if hasFeatureAnywhere(getUserDetails().permissions, Features.SCOUT) && getConfig().tools.scout}
		<ToolLink
			Icon={Binoculars}
			title={m.tool_scout_title()}
			description={m.tool_scout_description()}
			onclick={() => {
				const map = getMap();
				if (!map) return;
				setJustChangedMenus();
				setCurrentScoutCoords([Coords.infer(map.getCenter())]);
				setCurrentScoutCenter(Coords.infer(map.getCenter()));
				openMenu(Menu.SCOUT);
			}}
		></ToolLink>
	{/if}

	{#if hasFeatureAnywhere(getUserDetails().permissions, Features.FOLLOW_ME) && getConfig().tools.followMe}
		{#if getFollowMeNotice() === "covered"}
			<Card class="border-destructive/40 bg-destructive/10 px-4 py-3">
				<p class="font-semibold text-destructive">{m.followme_covered_title()}</p>
				<p class="text-destructive/80 mt-1 text-sm">
					{m.followme_covered_lead()}
					<a class="underline underline-offset-2" href="/coverage">{m.followme_covered_link()}</a>.
				</p>
			</Card>
		{:else}
			<!--
				The toggle is part of the follow-me card rather than a row floating
				under it: it is an option belonging to this tool and nothing else, and
				a switch sitting on its own below the card read as a separate setting.
				It stays outside the button, because a switch inside one is a button
				inside a button - the tool would fire every time it was flipped.
			-->
			<div
				class={getConfig().tools.followMeAlerts
					? "bg-card text-card-foreground overflow-hidden rounded-lg border shadow-md"
					: ""}
			>
				<ToolLink
					Icon={LocateFixed}
					title={m.tool_follow_me_title()}
					description={getFollowMeSummary()}
					onclick={toggleFollowMe}
					class={getConfig().tools.followMeAlerts ? "border-0! shadow-none!" : ""}
				></ToolLink>
				{#if getConfig().tools.followMeAlerts}
					<label
						class="flex cursor-pointer items-center justify-between gap-3 border-t px-4 py-2.5 text-sm"
					>
						<span class="text-muted-foreground min-w-0">{m.followme_alerts_toggle()}</span>
						<Switch
							checked={getUserSettings().followMeMoveAlerts}
							onCheckedChange={(checked) => {
								getUserSettings().followMeMoveAlerts = checked;
								updateUserSettings();
							}}
						/>
					</label>
				{/if}
			</div>
		{/if}
	{/if}

	{#if isSupportedFeature("koji") && getConfig().tools.coverageMap && hasFeatureAnywhere(getUserDetails().permissions, Features.COVERAGE_MAP)}
		<ToolLink
			Icon={Earth}
			title={m.tool_coverage_map_title()}
			description={m.tool_coverage_map_description()}
			onclick={() => openCoverageMap()}
		></ToolLink>
	{/if}

	{#if hasFeatureAnywhere(getUserDetails().permissions, Features.WAYFARER_MAP)}
		<ToolLink
			Icon={MapPin}
			title={m.tool_wayfarer_title()}
			description={m.tool_wayfarer_description()}
			onclick={() => openWayfarerMap()}
		/>
	{/if}
</div>
