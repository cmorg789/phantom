/**
 * Maps Slack-style emoji names to Unicode emoji for Discord.
 * status-reactions.ts uses Slack names; Discord reactions need Unicode.
 */

const SLACK_TO_UNICODE: Record<string, string> = {
	// Status reaction emojis (from DEFAULT_EMOJIS)
	eyes: "\uD83D\uDC40",
	brain: "\uD83E\uDDE0",
	wrench: "\uD83D\uDD27",
	computer: "\uD83D\uDCBB",
	globe_with_meridians: "\uD83C\uDF10",
	white_check_mark: "\u2705",
	warning: "\u26A0\uFE0F",
	hourglass_flowing_sand: "\u23F3",
	exclamation: "\u2757",
	// Common feedback emojis
	thumbsup: "\uD83D\uDC4D",
	thumbsdown: "\uD83D\uDC4E",
	"+1": "\uD83D\uDC4D",
	"-1": "\uD83D\uDC4E",
	heart: "\u2764\uFE0F",
	tada: "\uD83C\uDF89",
	rocket: "\uD83D\uDE80",
	thinking_face: "\uD83E\uDD14",
};

/** Convert a Slack emoji name to Unicode. Returns the name prefixed with : if unknown. */
export function slackEmojiToUnicode(name: string): string {
	return SLACK_TO_UNICODE[name] ?? `:${name}:`;
}

/** Check whether a Discord emoji reaction is positive. */
export function isPositiveReaction(emoji: string): boolean {
	const positive = new Set(["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83C\uDF89", "\uD83D\uDE80", "\u2705"]);
	return positive.has(emoji);
}

/** Check whether a Discord emoji reaction is negative. */
export function isNegativeReaction(emoji: string): boolean {
	const negative = new Set(["\uD83D\uDC4E"]);
	return negative.has(emoji);
}
