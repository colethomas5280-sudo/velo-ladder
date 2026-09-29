/* ------------------------------------------------------------------ *
 * Placement constants
 *
 * Every number here is a judgment call, not a physical law, so each one
 * carries where it came from. Change a value here and the classifier and
 * its disclosures move with it; nothing below should ever be inlined
 * elsewhere.
 * ------------------------------------------------------------------ */

/** From the scoring guide: how far above High + this many mph counts as an
 * outlier when the row has no elite-trajectory reference to check against. */
export const OUTLIER_BUFFER_MPH = 3;

/** From the scoring guide: peak minus sitting at or above this many mph
 * flags a projectability gap (room left in the arm above the sitting mark). */
export const PEAK_GAP_FLAG_MPH = 4;

/** Confirmed by Cole on 2026-09-28: sitting at or below Low minus this many
 * mph is "notably behind" rather than plain below average. */
export const NOTABLY_BEHIND_BUFFER_MPH = 5;

/** Confirmed by Cole on 2026-09-28: sitting minus floor at or above this
 * many mph flags fatigue or a consistency issue within the session. */
export const FATIGUE_GAP_FLAG_MPH = 6;

/** Sanity bound from the spec: a session velocity below this is refused. */
export const MIN_MPH = 30;

/** Sanity bound from the spec: a session velocity above this is refused. */
export const MAX_MPH = 110;
