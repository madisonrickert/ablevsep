/**
 * mvsep credit cost + per-plan limits. Premium accounts spend prepaid credits per job; free
 * accounts don't (they get a daily quota instead, which the API doesn't expose). See
 * mvsep.com/credits and mvsep.com/plans.
 */

/**
 * Credits mvsep deducts for one job: `floor(minutes × price_coefficient)`, minimum 1.
 * The multiply happens BEFORE the floor (mvsep.com/credits: 6:20 × 4 = 25.33 → 25; a standard
 * model ×1 → floor(6.33) = 6).
 */
export function creditEstimate(seconds: number, priceCoefficient: number): number {
  if (!(seconds > 0)) return 1;
  const coeff = priceCoefficient > 0 ? priceCoefficient : 1;
  return Math.max(1, Math.floor((seconds * coeff) / 60));
}

export interface PlanLimits {
  maxSeconds: number;
  maxBytes: number;
}

const MB = 1024 * 1024;

/** Per-plan upload caps from mvsep.com/plans (registered-free vs premium). */
export const PLAN_LIMITS: { free: PlanLimits; premium: PlanLimits } = {
  free: { maxSeconds: 10 * 60, maxBytes: 100 * MB },
  premium: { maxSeconds: 100 * 60, maxBytes: 1000 * MB },
};

export function planLimits(premium: boolean): PlanLimits {
  return premium ? PLAN_LIMITS.premium : PLAN_LIMITS.free;
}

/**
 * Human-readable reasons the audio exceeds the account's plan caps, or `[]` if within limits.
 * Unknown (undefined) measurements are skipped so we never warn on data we couldn't measure.
 */
export function planLimitViolations(input: { seconds?: number; bytes?: number; premium: boolean }): string[] {
  const lim = planLimits(input.premium);
  const out: string[] = [];
  if (typeof input.seconds === "number" && input.seconds > lim.maxSeconds) {
    const mins = Math.floor(input.seconds / 60);
    out.push(
      `Audio is ~${mins} min, over the ${lim.maxSeconds / 60} min limit` +
        (input.premium ? ". Trim the clip." : " for free accounts. Enable premium usage (up to 100 min) or trim it."),
    );
  }
  if (typeof input.bytes === "number" && input.bytes > lim.maxBytes) {
    const mb = Math.round(input.bytes / MB);
    out.push(
      `File is ~${mb} MB, over the ${lim.maxBytes / MB} MB limit` +
        (input.premium ? ". Use a shorter clip." : " for free accounts. Enable premium usage (up to 1000 MB) or use a shorter clip."),
    );
  }
  return out;
}
