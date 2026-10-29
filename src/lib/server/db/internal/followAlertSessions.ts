import { db } from ".";
import * as table from "./schema";
import { eq } from "drizzle-orm";

/**
 * Who is currently parked on a follow profile in Poracle.
 *
 * In the database rather than in memory because the consequence of losing it
 * is a user left with their alerts pointed at wherever they last were, with
 * nothing to tell us to put them back. A deploy must not be able to do that,
 * so the row outlives the process and initDiadem sweeps whatever it finds.
 */
export type AlertSession = typeof table.followAlertSession.$inferSelect;

export async function readAlertSession(userId: string): Promise<AlertSession | undefined> {
	const rows = await db
		.select()
		.from(table.followAlertSession)
		.where(eq(table.followAlertSession.userId, userId))
		.limit(1);

	return rows[0];
}

export async function listAlertSessions(): Promise<AlertSession[]> {
	return db.select().from(table.followAlertSession);
}

export async function writeAlertSession(session: {
	userId: string;
	poracleId: string;
	followProfileNo: number;
	returnProfileNo: number;
}) {
	const row = { ...session, startedAt: new Date() };
	await db
		.insert(table.followAlertSession)
		.values(row)
		.onDuplicateKeyUpdate({ set: row });
}

export async function clearAlertSession(userId: string) {
	await db.delete(table.followAlertSession).where(eq(table.followAlertSession.userId, userId));
}
