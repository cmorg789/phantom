/**
 * Discord feedback button components.
 * Equivalent of Slack Block Kit feedback buttons, using Discord's
 * ActionRow and Button components.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from "discord.js";
import type { ActionHint } from "./feedback.ts";

const FEEDBACK_PREFIX = "phantom:feedback:";

export function buildDiscordFeedbackComponents(messageId: string): ActionRowBuilder<MessageActionRowComponentBuilder> {
	return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`${FEEDBACK_PREFIX}positive:${messageId}`)
			.setLabel("Helpful")
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(`${FEEDBACK_PREFIX}negative:${messageId}`)
			.setLabel("Not helpful")
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId(`${FEEDBACK_PREFIX}partial:${messageId}`)
			.setLabel("Could be better")
			.setStyle(ButtonStyle.Secondary),
	);
}

export function buildDiscordActionComponents(
	actions: ActionHint[],
): ActionRowBuilder<MessageActionRowComponentBuilder> {
	const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

	for (let i = 0; i < Math.min(actions.length, 5); i++) {
		const action = actions[i];
		const style = action.style === "danger" ? ButtonStyle.Danger : ButtonStyle.Primary;
		row.addComponents(
			new ButtonBuilder().setCustomId(`phantom:action:${i}`).setLabel(action.label.slice(0, 80)).setStyle(style),
		);
	}

	return row;
}

export function buildDiscordFeedbackAck(choice: string): string {
	const labels: Record<string, string> = {
		positive: "Thanks for the feedback!",
		negative: "Sorry about that. I'll try to do better.",
		partial: "Thanks - I'll work on improving.",
	};
	return `*${labels[choice] ?? "Feedback recorded."}*`;
}

/** Parse a Discord button custom_id into a feedback type. Returns null if not a feedback button. */
export function parseDiscordFeedbackId(
	customId: string,
): { type: "positive" | "negative" | "partial"; messageId: string } | null {
	if (!customId.startsWith(FEEDBACK_PREFIX)) return null;
	const rest = customId.slice(FEEDBACK_PREFIX.length);
	const colonIdx = rest.indexOf(":");
	if (colonIdx === -1) return null;

	const type = rest.slice(0, colonIdx);
	const messageId = rest.slice(colonIdx + 1);
	if (type !== "positive" && type !== "negative" && type !== "partial") return null;
	return { type, messageId };
}
