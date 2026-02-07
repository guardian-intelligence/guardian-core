/**
 * TestClock
 *
 * Fixed-time Clock layer factory for tests.
 * Returns the same timestamp from currentTimeMillis every time.
 */
import { Clock, Effect, Layer } from 'effect';

/**
 * Create a fixed-time Clock layer for testing.
 *
 * @param fixedMs - The fixed timestamp in milliseconds since epoch
 * @returns Layer<Clock.Clock>
 *
 * @example
 * ```ts
 * const testClock = makeTestClock(1706745600000); // 2024-02-01T00:00:00Z
 * const result = Effect.runSync(
 *   program.pipe(Effect.provide(testClock)),
 * );
 * ```
 */
export function makeTestClock(fixedMs: number): Layer.Layer<Clock.Clock> {
	const clock: Clock.Clock = {
		[Clock.ClockTypeId]: Clock.ClockTypeId,
		unsafeCurrentTimeMillis: () => fixedMs,
		currentTimeMillis: Effect.succeed(fixedMs),
		unsafeCurrentTimeNanos: () => BigInt(fixedMs) * BigInt(1_000_000),
		currentTimeNanos: Effect.succeed(BigInt(fixedMs) * BigInt(1_000_000)),
		sleep: () => Effect.void,
	};

	return Layer.succeed(Clock.Clock, clock);
}
