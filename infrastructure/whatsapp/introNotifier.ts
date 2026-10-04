/**
 * Intro Notifier (DISABLED)
 *
 * Previously sent notifications to a mentor group when a new member joined
 * a Bot 2 (DKB) group. This feature has been disabled entirely.
 */

export const INTRO_NOTIFY_SETTING_KEY = "intro_notify_group_jid";

/**
 * Formerly notified the mentor group about a newly-added member.
 * Disabled: No-op.
 */
export async function notifyMentorGroupOfNewMember(
  _sock: any,
  _sourceGroupJid: string,
  _addedJid: string,
): Promise<void> {
  // Feature disabled entirely
  return;
}
