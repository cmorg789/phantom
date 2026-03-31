/**
 * Discord channel adapter implementing PrimaryChannel.
 * Connects via discord.js gateway, listens for DMs from owner
 * and @mentions in guild channels, supports threading, reactions,
 * message editing, and feedback buttons.
 */

import { randomUUID } from "node:crypto";
import { ChannelType, Client, GatewayIntentBits, type Message, type TextChannel } from "discord.js";
import { registerDiscordInteractions } from "./discord-actions.ts";
import { buildDiscordFeedbackComponents } from "./discord-feedback.ts";
import { splitDiscordMessage, toDiscordMarkdown } from "./discord-formatter.ts";
import { slackEmojiToUnicode } from "./emoji-map.ts";
import type { PrimaryChannel, ReactionHandler } from "./primary-channel.ts";
import type { ChannelCapabilities, InboundMessage, OutboundMessage, SentMessage } from "./types.ts";

export type DiscordChannelConfig = {
	botToken: string;
	guildId: string;
	defaultChannelId?: string;
	ownerUserId?: string;
};

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export class DiscordChannel implements PrimaryChannel {
	readonly id = "discord";
	readonly name = "Discord";
	readonly capabilities: ChannelCapabilities = {
		threads: true,
		richText: true,
		attachments: true,
		buttons: true,
		reactions: true,
		progressUpdates: true,
		messageEditing: true,
	};

	private client: Client;
	private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;
	private reactionHandler: ReactionHandler | null = null;
	private connectionState: ConnectionState = "disconnected";
	private ownerUserId: string | null;
	readonly guildId: string;
	private phantomName = "Phantom";
	private rejectedUsers = new Set<string>();

	constructor(config: DiscordChannelConfig) {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.DirectMessageReactions,
			],
		});
		this.guildId = config.guildId;
		this.ownerUserId = config.ownerUserId ?? null;
		this.registerEventHandlers();
		registerDiscordInteractions(this.client);
	}

	async connect(): Promise<void> {
		this.connectionState = "connecting";
		try {
			await this.client.login(this.client.token ?? "");
			await new Promise<void>((resolve) => {
				if (this.client.isReady()) {
					resolve();
				} else {
					this.client.once("ready", () => resolve());
				}
			});
			this.connectionState = "connected";
			console.log(`[discord] Connected as ${this.client.user?.tag}`);
		} catch (err) {
			this.connectionState = "error";
			throw err;
		}
	}

	/** Connect with an already-configured token. Called from index.ts after construction. */
	async connectWithToken(token: string): Promise<void> {
		this.connectionState = "connecting";
		try {
			await this.client.login(token);
			await new Promise<void>((resolve) => {
				if (this.client.isReady()) {
					resolve();
				} else {
					this.client.once("ready", () => resolve());
				}
			});
			this.connectionState = "connected";
			console.log(`[discord] Connected as ${this.client.user?.tag}`);
		} catch (err) {
			this.connectionState = "error";
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		this.client.destroy();
		this.connectionState = "disconnected";
		console.log("[discord] Disconnected");
	}

	async send(conversationId: string, message: OutboundMessage): Promise<SentMessage> {
		const { channelId } = parseConversationId(conversationId);
		const formatted = toDiscordMarkdown(message.text);
		const chunks = splitDiscordMessage(formatted);

		let lastMsg: Message | null = null;
		const channel = await this.client.channels.fetch(channelId);
		if (!channel?.isTextBased()) throw new Error(`Channel ${channelId} is not text-based`);

		for (const chunk of chunks) {
			lastMsg = await (channel as TextChannel).send(chunk);
		}

		if (!lastMsg) throw new Error("No message sent");

		return {
			id: lastMsg.id,
			channelId: "discord",
			conversationId,
			timestamp: new Date(lastMsg.createdTimestamp),
		};
	}

	onMessage(handler: (message: InboundMessage) => Promise<void>): void {
		this.messageHandler = handler;
	}

	onReaction(handler: ReactionHandler): void {
		this.reactionHandler = handler;
	}

	async sendDm(userId: string, text: string): Promise<string | null> {
		try {
			const user = await this.client.users.fetch(userId);
			const dm = await user.createDM();
			const formatted = toDiscordMarkdown(text);
			const chunks = splitDiscordMessage(formatted);
			let lastMsg: Message | null = null;
			for (const chunk of chunks) {
				lastMsg = await dm.send(chunk);
			}
			return lastMsg?.id ?? null;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[discord] Failed to send DM to ${userId}: ${msg}`);
			return null;
		}
	}

	async postToChannel(channelId: string, text: string): Promise<string | null> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return null;
			const formatted = toDiscordMarkdown(text);
			const chunks = splitDiscordMessage(formatted);
			let lastMsg: Message | null = null;
			for (const chunk of chunks) {
				lastMsg = await (channel as TextChannel).send(chunk);
			}
			return lastMsg?.id ?? null;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[discord] Failed to post to channel ${channelId}: ${msg}`);
			return null;
		}
	}

	async postThinking(channelId: string, _threadId: string): Promise<string | null> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return null;
			const msg = await (channel as TextChannel).send("*Working on it...*");
			return msg.id;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[discord] Failed to post thinking: ${msg}`);
			return null;
		}
	}

	async updateMessage(channelId: string, messageId: string, text: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return;
			const message = await (channel as TextChannel).messages.fetch(messageId);
			const formatted = toDiscordMarkdown(text);
			await message.edit(formatted);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[discord] Failed to update message: ${msg}`);
		}
	}

	async updateWithFeedback(channelId: string, messageId: string, text: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return;
			const message = await (channel as TextChannel).messages.fetch(messageId);
			const formatted = toDiscordMarkdown(text);
			const chunks = splitDiscordMessage(formatted);

			if (chunks.length === 1) {
				const feedbackRow = buildDiscordFeedbackComponents(messageId);
				await message.edit({ content: chunks[0], components: [feedbackRow] });
			} else {
				// For multi-chunk messages, edit the first, send the rest, feedback on last
				await message.edit(chunks[0]);
				let lastMsg = message;
				for (let i = 1; i < chunks.length; i++) {
					lastMsg = await (channel as TextChannel).send(chunks[i]);
				}
				const feedbackRow = buildDiscordFeedbackComponents(lastMsg.id);
				await lastMsg.edit({ content: lastMsg.content, components: [feedbackRow] });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[discord] Failed to update with feedback: ${msg}`);
		}
	}

	async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return;
			const message = await (channel as TextChannel).messages.fetch(messageId);
			const unicode = slackEmojiToUnicode(emoji);
			await message.react(unicode);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[discord] Failed to add reaction: ${msg}`);
		}
	}

	async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel?.isTextBased()) return;
			const message = await (channel as TextChannel).messages.fetch(messageId);
			const unicode = slackEmojiToUnicode(emoji);
			const botUserId = this.client.user?.id;
			if (botUserId) {
				await message.reactions.cache.get(unicode)?.users.remove(botUserId);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[discord] Failed to remove reaction: ${msg}`);
		}
	}

	getOwnerUserId(): string | null {
		return this.ownerUserId;
	}

	setPhantomName(name: string): void {
		this.phantomName = name;
	}

	isConnected(): boolean {
		return this.connectionState === "connected";
	}

	getConnectionState(): ConnectionState {
		return this.connectionState;
	}

	getClient(): Client {
		return this.client;
	}

	private isOwner(userId: string): boolean {
		return this.ownerUserId === null || userId === this.ownerUserId;
	}

	private registerEventHandlers(): void {
		this.client.on("messageCreate", async (message) => {
			// Ignore bot messages
			if (message.author.bot) return;
			if (message.author.id === this.client.user?.id) return;

			const isDm = message.channel.type === ChannelType.DM;
			const isMention = message.mentions.has(this.client.user?.id ?? "");
			const isThread =
				message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread;

			if (!isDm && !isMention && !isThread) return;

			// Owner check
			if (!this.isOwner(message.author.id)) {
				if (!this.rejectedUsers.has(message.author.id)) {
					this.rejectedUsers.add(message.author.id);
					if (isDm) {
						await message.reply(
							`Hey! I'm ${this.phantomName}. I only work with my owner right now. If you need access, ask them to add you.`,
						);
					}
					console.log(`[discord] Ignoring ${isDm ? "DM" : "mention"} from non-owner: ${message.author.id}`);
				}
				return;
			}

			if (!this.messageHandler) return;

			// Strip bot mention from text
			let text = message.content;
			if (this.client.user) {
				text = text.replace(new RegExp(`<@!?${this.client.user.id}>\\s*`, "g"), "").trim();
			}

			if (!text) return;

			// Build conversation ID. For threads, use the thread channel.
			// For regular messages, use the channel + message ID.
			const channelId = message.channel.id;
			const threadId = isThread ? channelId : undefined;
			const conversationId = `discord:${channelId}:${message.id}`;

			const inbound: InboundMessage = {
				id: randomUUID(),
				channelId: "discord",
				conversationId,
				threadId,
				senderId: message.author.id,
				senderName: message.author.displayName ?? message.author.username,
				text,
				timestamp: new Date(message.createdTimestamp),
				metadata: {
					discordChannelId: channelId,
					discordMessageId: message.id,
					discordThreadId: threadId,
				},
			};

			try {
				await this.messageHandler(inbound);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[discord] Error handling message: ${msg}`);
			}
		});

		// Handle emoji reactions for feedback
		this.client.on("messageReactionAdd", async (reaction, user) => {
			if (user.bot) return;
			if (user.id === this.client.user?.id) return;
			if (!this.reactionHandler) return;

			const emoji = reaction.emoji.name ?? "";
			const positive = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83C\uDF89", "\u2705"].includes(emoji);
			const negative = ["\uD83D\uDC4E"].includes(emoji);
			if (!positive && !negative) return;

			this.reactionHandler({
				reaction: emoji,
				userId: user.id,
				messageTs: reaction.message.id,
				channel: reaction.message.channelId,
				isPositive: positive,
			});
		});
	}
}

function parseConversationId(conversationId: string): { channelId: string; messageId: string } {
	const parts = conversationId.split(":");
	if (parts.length >= 3 && parts[0] === "discord") {
		return { channelId: parts[1], messageId: parts[2] };
	}
	return { channelId: conversationId, messageId: "" };
}
