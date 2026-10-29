import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";

// Transport for PoracleNG's authenticated /api surface, shared by the features
// that talk to it. Deliberately gated on nothing but a configured url: linked
// trainer syncing and follow-me alerts are switched on separately and have no
// business disabling each other.

const log = getLogger("poracle");

const TIMEOUT_MS = 10_000;

export function getPoracleApi() {
	const poracle = getServerConfig().poracle;
	if (!poracle?.url) return undefined;
	return poracle;
}

export async function callPoracle(
	path: string,
	method: "GET" | "POST" | "PATCH" | "DELETE",
	body?: unknown
): Promise<Response | undefined> {
	const poracle = getPoracleApi();
	if (!poracle) return undefined;

	const headers: HeadersInit = { Accept: "application/json" };
	if (poracle.secret) headers["X-Poracle-Secret"] = poracle.secret;
	if (body !== undefined) headers["Content-Type"] = "application/json";

	try {
		return await fetch(new URL(path, poracle.url), {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		log.warning("[%s %s] Poracle request failed: %s", method, path, err);
		return undefined;
	}
}
