import {
	boolean,
	datetime,
	index,
	int,
	json,
	mysqlTable,
	primaryKey,
	text,
	uniqueIndex,
	varchar
} from "drizzle-orm/mysql-core";

export const user = mysqlTable(
	"user",
	{
		id: varchar("id", { length: 255 }).primaryKey(),
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull(),
		emailVerified: boolean("email_verified").notNull(),
		image: text("image"),
		discordId: varchar("discord_id", { length: 255 }).notNull().unique(),
		userSettings: json("user_settings"),
		createdAt: datetime("created_at").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		emailUnique: uniqueIndex("user_email_unique").on(table.email)
	})
);

export const session = mysqlTable(
	"session",
	{
		id: varchar("id", { length: 255 }).primaryKey(),
		userId: varchar("user_id", { length: 255 })
			.notNull()
			.references(() => user.id),
		expiresAt: datetime("expires_at").notNull(),
		token: varchar("token", { length: 255 }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: datetime("created_at").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		tokenUnique: uniqueIndex("session_token_unique").on(table.token),
		userIdIdx: index("session_user_id_idx").on(table.userId),
		expiresAtIdx: index("session_expires_at_idx").on(table.expiresAt)
	})
);

export type Session = typeof session.$inferSelect;

export const account = mysqlTable(
	"account",
	{
		id: varchar("id", { length: 255 }).primaryKey(),
		accountId: varchar("account_id", { length: 255 }).notNull(),
		providerId: varchar("provider_id", { length: 255 }).notNull(),
		userId: varchar("user_id", { length: 255 })
			.notNull()
			.references(() => user.id),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: datetime("access_token_expires_at"),
		refreshTokenExpiresAt: datetime("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: datetime("created_at").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		providerAccountUnique: uniqueIndex("account_provider_account_unique").on(
			table.providerId,
			table.accountId
		),
		userIdIdx: index("account_user_id_idx").on(table.userId)
	})
);

export const verification = mysqlTable(
	"verification",
	{
		id: varchar("id", { length: 255 }).primaryKey(),
		identifier: varchar("identifier", { length: 255 }).notNull(),
		value: text("value").notNull(),
		expiresAt: datetime("expires_at").notNull(),
		createdAt: datetime("created_at").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		identifierIdx: index("verification_identifier_idx").on(table.identifier),
		expiresAtIdx: index("verification_expires_at_idx").on(table.expiresAt)
	})
);

export const linkedTrainer = mysqlTable(
	"linked_trainer",
	{
		id: varchar("id", { length: 255 }).primaryKey(),
		userId: varchar("user_id", { length: 255 })
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// PlayerID ticket, kept until it resolves (or fails/expires)
		jobId: varchar("job_id", { length: 255 }),
		status: varchar("status", { length: 32 }).notNull(),
		playerId: varchar("player_id", { length: 255 }),
		trainerName: varchar("trainer_name", { length: 255 }),
		createdAt: datetime("created_at").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		userIdIdx: index("linked_trainer_user_id_idx").on(table.userId),
		userPlayerUnique: uniqueIndex("linked_trainer_user_player_unique").on(
			table.userId,
			table.playerId
		)
	})
);

export type LinkedTrainer = typeof linkedTrainer.$inferSelect;

export type User = typeof user.$inferSelect;

/**
 * Scout locations a user has spent today, across every endpoint that spends
 * them - follow-me and the manual scout tool draw on one allowance.
 *
 * This is in the database rather than in memory because the hourly limiter is
 * RateLimiterMemory, which resets on every restart. An hour mostly survives
 * that; a day does not, and a daily cap a deploy wipes is not a cap. Rows are
 * disposable: anything older than yesterday can be deleted at any time.
 */
export const scoutDailySpend = mysqlTable(
	"scout_daily_spend",
	{
		userId: varchar("user_id", { length: 255 })
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Calendar day as YYYY-MM-DD, in the server's own timezone. */
		day: varchar("day", { length: 10 }).notNull(),
		locations: int("locations").notNull(),
		updatedAt: datetime("updated_at").notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.day] })
	})
);

export type ScoutDailySpend = typeof scoutDailySpend.$inferSelect;
