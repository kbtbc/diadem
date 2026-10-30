import { MapObjectType } from "@/lib/mapObjects/mapObjectTypes";

import type { FeaturesKey } from "@/lib/utils/features";

type UiconSetModifiers = {
	default: boolean;
	scale?: number;
	offsetX?: number;
	offsetY?: number;
	name?: string;
	spacing?: number;
};

export type UiconSetModifierType =
	| MapObjectType
	| "quest"
	| "invasion"
	| "max_battle"
	| "raid_pokemon"
	| "raid_pokemon_6"
	| "raid_egg"
	| "raid_egg_6";

export type UiconSet = {
	id: string;
	name: string;
	url: string;
	base: UiconSetModifiers | undefined;
} & {
	[key in UiconSetModifierType]: UiconSetModifiers | boolean | undefined;
};

type General = {
	mapName: string;
	defaultLocale: string;
	customHome: boolean;
	defaultLat?: number;
	defaultLon?: number;
	defaultZoom?: number;
	minZoom?: number;
	maxZoom?: number;
	url?: string;
	image?: string;
	description?: string;
	allowCrawlers?: boolean;
	disallowedPaths?: string[];
	/** Default true. Set to false to exchange JSON instead of MessagePack with the API (less CPU, more bytes). */
	msgpack?: boolean;
};

export type DbCreds = {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
};

type Auth = {
	enabled: boolean;
	optional: boolean;
	secret?: string;
	baseUrl?: string;
	discord?: AuthDiscord;
};

type AuthDiscord = {
	clientId: string;
	clientSecret: string;
};

type ClientDiscord = {
	serverLink: string;
	serverId: string;
};

export type Permissions = {
	everyone?: boolean;
	loggedIn?: boolean;
	guildId?: string;
	roleId?: string;
	areas?: string[];
	features?: FeaturesKey[];
};

export type Log = {
	level: string;
	file?: string;
};

export type MapStyle = {
	id: string;
	name: string;
	url: string;
	default?: "dark" | "light";
	theme?: "dark" | "light" | "satellite";
	colors?: "dark" | "light";
	raster?: {
		min: number;
		max: number;
		tileSize: number;
	};
	attribution?: string;
};

type MapPositions = {
	styleLat: number;
	styleLon: number;
	styleZoom: number;
	coverageLat: number;
	coverageLon: number;
	coverageZoom: number;
	scoutLat: number;
	scoutLon: number;
	scoutZoom: number;
	coverageMapLat?: number;
	coverageMapLon?: number;
	coverageMapZoom?: number;
};

type StaticMap = {
	enabled: boolean;
	url: string;
	diademUrl: string;
	style?: string;
};

export type ClientConfig = {
	coverage?: import("@/lib/features/kojiRules").CoverageRules;
	mapStyles: MapStyle[];
	uiconSets: UiconSet[];
	general: General;
	discord: ClientDiscord;
	mapPositions: MapPositions;
	tools: {
		showToolsMenu: boolean;
		coverageMap: boolean;
		scout: boolean;
		/** Optional: absent means follow-me stays hidden. */
		followMe?: boolean;
		/** Offer to move the user's Poracle alerts along with follow-me. */
		followMeAlerts?: boolean;
	};
	followMe?: {
		/** Pause above this ground speed. Default 60. */
		maxSpeedKmh?: number;
		/** Resume below this. Default two thirds of maxSpeedKmh, so 40. */
		resumeSpeedKmh?: number;
		/** Floor between scans. Default 60, never less than 15. */
		minScanIntervalSeconds?: number;
	};
};

export type ServerConfig = {
	encounterIdObfuscation?: {
		enabled?: boolean;
		secret?: string;
	};
	biomes?: {
		url?: string;
		secret?: string;
	};
	golbat: {
		url: string;
		auth?: string;
		secret?: string;
		defaultNestName?: string;
		grpc?: string;
		fortApi?: boolean;
	};
	talonflame?: { url: string };
	dragonite: {
		// TODO: this should be optional and scout disabled
		url: string;
		secret?: string;
		basicAuth?: string;
	};
	db: DbCreds;
	koji?: {
		url: string;
		secret: string;
		projectName: string;
	};
	nominatim?: {
		url: string;
		basicAuth?: string;
		userAgent?: string;
	};
	pelias?: {
		url: string;
		apiKey?: string;
		basicAuth?: string;
	};
	photon?: {
		url: string;
		basicAuth?: string;
		hasGeometries?: boolean;
	};
	playerId?: {
		/** PlayerID service, e.g. https://playerid.mew.is */
		url: string;
		apiKey: string;
		/** Linked trainers per user. Default 10. */
		maxTrainers?: number;
	};
	poracle?: {
		/** PoracleNG API, e.g. http://127.0.0.1:3030 */
		url: string;
		secret?: string;
		/**
		 * Move a user's alert location with them while follow-me runs, by
		 * borrowing a "follow" profile. Default false.
		 */
		followMeAlerts?: boolean;
		/** How far they must travel before their alerts move. Default 1000. */
		alertMinMeters?: number;
		/** And never more often than this. Default 60. */
		alertMinSeconds?: number;
	};
	scout?: {
		/**
		 * Scout locations one user may queue per day, across follow-me and the
		 * manual scout tool together. Default 8000, about 163 follow-me scans.
		 */
		locationsPerDay?: number;
		/** Most locations one request may ask for. Default 64. */
		maxLocationsPerRequest?: number;
		/**
		 * Ask scouts for route data. Default false: routes are static, so asking
		 * on every scan pays repeatedly for the same answer.
		 */
		routes?: boolean;
		/** Ask scouts for showcase data. Default true. */
		showcases?: boolean;
		/** Ask scouts for gyms and stops (get-map-forts). Default true. */
		forts?: boolean;
	};
	followMe?: {
		/** Scans per user per hour. Default 24. */
		scansPerHour?: number;
		/** Concurrent followers across the instance. Default 70. */
		maxFollowers?: number;
		/** Back off above this scout queue depth. Default 50. */
		queueLimit?: number;
		/**
		 * "overlap" skips a scan if any of its 49 points falls in a covered
		 * area; "center" skips only when the user stands in one. Default
		 * "overlap".
		 */
		overlapMode?: "overlap" | "center";
		/**
		 * Discord ids that may scan inside a covered area anyway.
		 *
		 * For testing follow-me without driving out of town first: coverage is
		 * the one refusal that stops the session rather than retrying, so there
		 * is otherwise no way to exercise a whole session from a desk. Every scan
		 * one of these users gets still costs them quota and daily allowance, and
		 * is logged as having skipped the check.
		 */
		coverageExemptDiscordIds?: string[];
		/*
		 * There is deliberately no covered/uncovered area list here any more:
		 * coverage comes from Dragonite's /v2/areas/, which carries the mode
		 * flags and the geofences, so there is nothing left to correct by hand.
		 */
	};
	log: Log;
	internalDb: DbCreds;
	auth: Auth;
	permissions?: Permissions[];
	staticMap?: StaticMap;
	limits?: {
		enableRateLimiting?: boolean;
		nonDeltaMultiplier?: number;
		heavyFilterMultiplier?: number;
		heavyFilterRatio?: number;
		captchaOnRateLimit?: boolean;
		captchaReward?: number;
	} & {
		[key in MapObjectType]?: {
			requestLimit?: number;
			rateLimit?: number;
			rateLimitTime?: number;
		};
	};
};

export type Config = {
	server: ServerConfig;
	client: ClientConfig;
};
