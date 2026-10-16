/**
 * What to tell the coach after asking the server to email an invite.
 *
 * Pure, so the wording and the "do we still need the link?" decision are
 * testable without a roster on screen. Lives apart from `lib/email.ts` because
 * that module reads secrets and has no business in a client bundle.
 */
export type InviteReply = {
  url: string;
  email: {
    sent: boolean;
    to?: string;
    reason?: string;
    detail?: string;
  } | null;
};

export function emailInviteOutcome(r: InviteReply): {
  message: string;
  copyLink: boolean;
} {
  const e = r.email;
  if (e?.sent) {
    return { message: `Invite emailed to ${e.to ?? "the athlete"}`, copyLink: false };
  }
  if (e?.reason === "send_failed") {
    return {
      message: `Couldn't email the invite: ${e.detail ?? "unknown error"}. Link copied instead`,
      copyLink: true,
    };
  }
  if (e?.reason === "bad_address") {
    return {
      message: "That athlete has no valid login email. Link copied instead",
      copyLink: true,
    };
  }
  if (e?.reason === "not_configured") {
    return {
      message: "Email isn't set up yet. Link copied instead",
      copyLink: true,
    };
  }
  return { message: "Invite link copied", copyLink: true };
}
