import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";

// Transport for PoracleNG's authenticated /api surface, shared by any feature
// that talks to it. Deliberately gated on nothing but a configured url: what
// each feature does with Poracle is switched on separately, so one being off
// must not disable another.

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
