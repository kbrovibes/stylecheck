import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Per-user daily AI budgets (Pacific-midnight reset) so one runaway user can't
 * burn the API budget. Admins are exempt. Nightly crons are not metered — they
 * are owner-scheduled work with their own caps.
 */
export const DAILY_IMAGE_LIMIT = 60; // renders / product shots / scenes
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

export function creditErrorResponse(e: unknown) {
  return e instanceof CreditError ? { error: e.message, status: 429 as const } : null;
}
