import { chargeLocations, refundLocations } from "@/lib/server/db/internal/scoutSpend";
import {
	resolveLocationsPerDay,
	resolveMaxLocationsPerRequest
} from "@/lib/server/features/scoutBudgetPolicy";
import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";

const log = getLogger("scout");

/**
 * One allowance per user per day, shared by follow-me and the manual scout
 * tool. Spending it one way really does leave less for the other, which is the
 * honest accounting: a follow-me scan costs 49 locations and a manual M costs
 * 7, so locations are the unit and scans are not.
 */
export function getLocationsPerDay(): number {
	return resolveLocationsPerDay(getServerConfig().scout?.locationsPerDay);
}

export function getMaxLocationsPerRequest(): number {
	return resolveMaxLocationsPerRequest(getServerConfig().scout?.maxLocationsPerRequest);
}

export type DailyChargeResult =
	| { ok: true; spent: number; limit: number }
	| { ok: false; spent: number; limit: number; reason: "daily budget" | "unavailable" };

/**
 * Charge a scan against the day's allowance.
 *
 * A database that will not answer refuses the scan rather than waving it
 * through: the whole point of this living in the database is that it cannot be
 * lost, and failing open would spend scouts with nothing counting them.
 */
export async function chargeDailyLocations(
	userId: string,
	locations: number
): Promise<DailyChargeResult> {
	const limit = getLocationsPerDay();

	try {
		const { ok, spent } = await chargeLocations(userId, locations, limit);
		if (ok) return { ok: true, spent, limit };
		return { ok: false, spent, limit, reason: "daily budget" };
	} catch (e) {
		log.error("Scout daily budget unreadable / user: %s / %s", userId, String(e));
		return { ok: false, spent: 0, limit, reason: "unavailable" };
	}
}

/** Hand the locations back when the queue would not take the scan. */
export async function refundDailyLocations(userId: string, locations: number) {
	try {
		await refundLocations(userId, locations);
	} catch (e) {
		// The user keeps a charge they did not get a scan for. Worth a line, not
		// worth failing the request that is already failing.
		log.error(
			"Scout daily refund failed / user: %s / locations: %d / %s",
			userId,
			locations,
			String(e)
		);
	}
}
