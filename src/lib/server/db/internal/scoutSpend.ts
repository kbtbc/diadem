import { db } from ".";
import * as table from "./schema";
import { scoutDay } from "@/lib/server/features/scoutBudgetPolicy";
import { and, eq, sql } from "drizzle-orm";

async function ensureRow(userId: string, day: string, now: Date) {
	// Needed because the conditional UPDATE below cannot distinguish "over
	// budget" from "no row yet", and would read a first-ever scan as refused.
	await db
		.insert(table.scoutDailySpend)
		.values({ userId, day, locations: 0, updatedAt: now })
		.onDuplicateKeyUpdate({ set: { userId } });
}

export async function getSpentLocations(userId: string, day: string = scoutDay()): Promise<number> {
	const rows = await db
		.select({ locations: table.scoutDailySpend.locations })
		.from(table.scoutDailySpend)
		.where(and(eq(table.scoutDailySpend.userId, userId), eq(table.scoutDailySpend.day, day)))
		.limit(1);

	return rows[0]?.locations ?? 0;
}

/**
 * Charge locations against today's allowance, all or nothing.
 *
 * The condition lives in the UPDATE rather than in a read beforehand, which is
 * what makes it safe: two requests arriving together cannot both see an
 * under-budget total and both spend it. Nothing is charged when it will not
 * fit, so there is no refund path here to get wrong.
 */
export async function chargeLocations(
	userId: string,
	locations: number,
	limit: number
): Promise<{ ok: boolean; spent: number }> {
	const day = scoutDay();
	const now = new Date();

	await ensureRow(userId, day, now);

	const result = await db
		.update(table.scoutDailySpend)
		.set({
			locations: sql`${table.scoutDailySpend.locations} + ${locations}`,
			updatedAt: now
		})
		.where(
			and(
				eq(table.scoutDailySpend.userId, userId),
				eq(table.scoutDailySpend.day, day),
				sql`${table.scoutDailySpend.locations} + ${locations} <= ${limit}`
			)
		);

	// mysql2 reports rows actually changed, and a charge always changes one, so
	// nothing changed means the condition refused it.
	const ok = (result[0]?.affectedRows ?? 0) > 0;

	return { ok, spent: await getSpentLocations(userId, day) };
}

/** Give locations back when the scan could not be queued after all. */
export async function refundLocations(userId: string, locations: number) {
	const day = scoutDay();

	await db
		.update(table.scoutDailySpend)
		.set({
			locations: sql`GREATEST(${table.scoutDailySpend.locations} - ${locations}, 0)`,
			updatedAt: new Date()
		})
		.where(and(eq(table.scoutDailySpend.userId, userId), eq(table.scoutDailySpend.day, day)));
}
