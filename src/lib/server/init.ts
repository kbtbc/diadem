import { masterfileProvider } from "@/lib/server/provider/masterfileProvider";
import { masterstatsProvider } from "@/lib/server/provider/masterStatsProvider";
import { remoteLocaleProvider } from "@/lib/server/provider/remoteLocaleProvider";
import { uiconsIndexProvider } from "@/lib/server/provider/uiconsIndexProvider";
import { startFortApiDetection } from "@/lib/server/api/golbat/fortAvailability";
import { restoreStrandedAlertFollows } from "@/lib/server/features/followMeAlerts";
import { getLogger } from "@/lib/utils/logger";
import "@/lib/server/encounterIds";

export async function initDiadem() {
	const log = getLogger("init");
	log.info("Initializing Diadem");

	await Promise.all([
		masterfileProvider.refresh(),
		uiconsIndexProvider.refresh(),
		remoteLocaleProvider.refresh(),
		masterstatsProvider.refresh(),
		startFortApiDetection()
	]);
	// Anyone a restart left on a follow profile, put back before they notice
	// their alerts measuring from the wrong place. Never blocks startup.
	void restoreStrandedAlertFollows();

	log.info("Finished initializing");
}
