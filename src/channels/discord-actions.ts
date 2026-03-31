/**
 * Discord interaction handlers: feedback buttons and agent-suggested actions.
 * Registers an interactionCreate listener that routes button clicks to the
 * appropriate subsystems (feedback -> evolution, actions -> agent follow-up).
 */

import type { Client } from "discord.js";
import { buildDiscordFeedbackAck, parseDiscordFeedbackId } from "./discord-feedback.ts";
import { emitFeedback } from "./feedback.ts";

export type DiscordActionFollowUpHandler = (params: {
	userId: string;
	channelId: string;
	messageId: string;
	actionLabel: string;
	actionPayload?: string;
	conversationId: string;
}) => Promise<void>;

let actionFollowUpHandler: DiscordActionFollowUpHandler | null = null;

export function setDiscordActionFollowUpHandler(handler: DiscordActionFollowUpHandler): void {
	actionFollowUpHandler = handler;
}

export function registerDiscordInteractions(client: Client): void {
	client.on("interactionCreate", async (interaction) => {
		if (!interaction.isButton()) return;

		const customId = interaction.customId;

		// Handle feedback buttons
		const feedback = parseDiscordFeedbackId(customId);
		if (feedback) {
			const channelId = interaction.channelId;
			const messageId = interaction.message.id;
			const userId = interaction.user.id;

			emitFeedback({
				type: feedback.type,
				conversationId: `discord:${channelId}:${messageId}`,
				messageTs: messageId,
				userId,
				source: "button",
				timestamp: Date.now(),
			});

			try {
				await interaction.update({
					content: interaction.message.content,
					components: [],
				});
				await interaction.followUp({
					content: buildDiscordFeedbackAck(feedback.type),
					flags: 64, // Ephemeral
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[discord] Failed to update feedback buttons: ${msg}`);
			}
			return;
		}

		// Handle agent action buttons
		if (customId.startsWith("phantom:action:")) {
			const channelId = interaction.channelId;
			const messageId = interaction.message.id;
			const userId = interaction.user.id;

			let label = "action";
			let payload: string | undefined;

			// Read the button label from the interaction component data
			const rawComponents = interaction.message.components as Array<{
				components?: Array<{ custom_id?: string; label?: string }>;
			}>;
			for (const row of rawComponents) {
				const match = row.components?.find((c) => c.custom_id === customId);
				if (match?.label) {
					label = match.label;
					break;
				}
			}

			try {
				await interaction.update({
					content: `${interaction.message.content}\n\n*${interaction.user.displayName} clicked: ${label}*`,
					components: [],
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[discord] Failed to update action buttons: ${msg}`);
			}

			if (actionFollowUpHandler) {
				await actionFollowUpHandler({
					userId,
					channelId,
					messageId,
					actionLabel: label,
					actionPayload: payload,
					conversationId: `discord:${channelId}:${messageId}`,
				});
			}
		}
	});
}
