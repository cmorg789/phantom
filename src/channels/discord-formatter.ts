/**
 * Discord message formatting utilities.
 * Discord renders standard markdown natively, so no conversion is needed.
 * The main concern is respecting Discord's 2000-character message limit.
 */

const DISCORD_MAX_LENGTH = 1900;

/**
 * Discord uses standard markdown, so this is a pass-through.
 * Exists for symmetry with toSlackMarkdown and as a hook for
 * any future Discord-specific formatting needs.
 */
export function toDiscordMarkdown(text: string): string {
	return text;
}

/**
 * Truncate text to Discord's message limit (2000 chars).
 * If truncated, appends a notice.
 */
export function truncateForDiscord(text: string, limit = DISCORD_MAX_LENGTH): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n\n*Response truncated. Full response was ${text.length} characters.*`;
}

/**
 * Split a long message into multiple chunks at safe boundaries.
 * Discord has a 2000 character limit per message.
 */
export function splitDiscordMessage(text: string, maxLength = DISCORD_MAX_LENGTH): string[] {
	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		let splitAt = remaining.lastIndexOf("\n\n", maxLength);
		if (splitAt < maxLength * 0.5) {
			splitAt = remaining.lastIndexOf("\n", maxLength);
		}
		if (splitAt < maxLength * 0.3) {
			splitAt = remaining.lastIndexOf(" ", maxLength);
		}
		if (splitAt < maxLength * 0.2) {
			splitAt = maxLength;
		}

		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}

	return chunks;
}
