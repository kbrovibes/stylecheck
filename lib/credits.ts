import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Per-user daily AI budgets (Pacific-midnight reset) so one runaway user can't
 * burn the API budget. Admins are exempt. Nightly crons are not metered — they
 * are owner-scheduled work with their own caps.
 *
 * These are DEFAULTS: sc_spend_credit prefers per-account overrides in
 * sc_settings.daily_image_limit / daily_text_limit when set, so a single user
 * can be raised without moving everyone's ceiling.
 *
 * Note: the counter increments before the cap is checked, so sc_usage counts
 * attempts (including rejected ones), not successful generations.
 */
export const DAILY_IMAGE_LIMIT = 100; // renders / product shots / scenes
export const DAILY_TEXT_LIMIT = 300; // classify / compose / audits

const ADMIN_EMAILS = ["k4rthikr@gmail.com"];

export class CreditError extends Error {
  status = 429 as const;
  constructor(kind: "image" | "text") {
    super(
      kind === "image"
        ? "Daily image credits used up — they refill at midnight PT."
        : "Daily styling credits used up — they refill at midnight PT."
    );
  }
}

/** Spend credits for the authed user; throws CreditError when over budget. */
export async function spendCredit(
  supabase: SupabaseClient,
  user: User,
  kind: "image" | "text",
  amount = 1
) {
  if (user.email && ADMIN_EMAILS.includes(user.email)) return;
  const { data, error } = await supabase.rpc("sc_spend_credit", {
    kind,
    amount,
    image_limit: DAILY_IMAGE_LIMIT,
    text_limit: DAILY_TEXT_LIMIT,
  });
  if (error) return; // fail-open: metering must never break the product
  if (data?.over) throw new CreditError(kind);
}

/** Today's date in the billing timezone, as YYYY-MM-DD (matches sc_usage.day). */
function pacificDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export interface CreditStatus {
  imageUsed: number;
  imageLimit: number;
  textUsed: number;
  textLimit: number;
  unlimited: boolean; // admins aren't metered
}

/** Today's spend + this account's effective caps, for display. */
export async function getCreditStatus(
  supabase: SupabaseClient,
  user: User
): Promise<CreditStatus> {
  const [{ data: usage }, { data: overrides }] = await Promise.all([
    supabase
      .from("sc_usage")
      .select("image_calls, text_calls")
      .eq("user_id", user.id)
      .eq("day", pacificDay())
      .maybeSingle(),
    supabase
      .from("sc_settings")
      .select("daily_image_limit, daily_text_limit")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  return {
    imageUsed: usage?.image_calls ?? 0,
    textUsed: usage?.text_calls ?? 0,
    imageLimit: overrides?.daily_image_limit ?? DAILY_IMAGE_LIMIT,
    textLimit: overrides?.daily_text_limit ?? DAILY_TEXT_LIMIT,
    unlimited: !!user.email && ADMIN_EMAILS.includes(user.email),
  };
}

export function creditErrorResponse(e: unknown) {
  return e instanceof CreditError ? { error: e.message, status: 429 as const } : null;
}
