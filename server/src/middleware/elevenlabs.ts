import type { Context, Next } from "hono";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

async function computeHmac(secret: string, message: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	const encoder = new TextEncoder();
	const bufA = encoder.encode(a);
	const bufB = encoder.encode(b);
	let result = 0;
	for (let i = 0; i < bufA.length; i++) {
		result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
	}
	return result === 0;
}

export async function verifyElevenLabsSignature(c: Context, next: Next) {
	const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
	if (!secret) {
		console.error("ELEVENLABS_WEBHOOK_SECRET not configured");
		return c.json({ error: "Server misconfigured" }, 500);
	}

	const signatureHeader = c.req.header("ElevenLabs-Signature");
	if (!signatureHeader) {
		return c.json({ error: "Missing signature" }, 401);
	}

	const parts = Object.fromEntries(
		signatureHeader.split(",").map((part) => {
			const [key, ...rest] = part.split("=");
			return [key, rest.join("=")] as const;
		}),
	);

	const timestamp = parts.t;
	const signature = parts.v0;

	if (!timestamp || !signature) {
		return c.json({ error: "Invalid signature format" }, 401);
	}

	const timestampMs = Number(timestamp) * 1000;
	if (Number.isNaN(timestampMs)) {
		return c.json({ error: "Invalid timestamp" }, 401);
	}

	const drift = Math.abs(Date.now() - timestampMs);
	if (drift > MAX_TIMESTAMP_DRIFT_MS) {
		return c.json({ error: "Timestamp too old" }, 401);
	}

	const body = await c.req.text();
	const message = `${timestamp}.${body}`;
	const expected = await computeHmac(secret, message);

	if (!timingSafeEqual(expected, signature)) {
		return c.json({ error: "Invalid signature" }, 401);
	}

	c.set("parsedBody", JSON.parse(body));
	return next();
}
