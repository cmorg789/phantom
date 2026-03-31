/**
 * PrimaryChannel extends the base Channel interface with rich interaction
 * methods that both Slack and Discord provide: DMs, reactions, message editing,
 * feedback buttons, and progress streaming. This abstraction lets index.ts,
 * the scheduler, and the trigger endpoint work with either channel uniformly.
 */

import type { Channel } from "./types.ts";

export type ReactionEvent = {
	reaction: string;
	userId: string;
	messageTs: string;
	channel: string;
	isPositive: boolean;
};

export type ReactionHandler = (event: ReactionEvent) => void;

export interface PrimaryChannel extends Channel {
	/** Send a direct message to a user. Returns a message ID or null. */
	sendDm(userId: string, text: string): Promise<string | null>;

	/** Post a message to a channel. Returns a message ID or null. */
	postToChannel(channelId: string, text: string): Promise<string | null>;

	/** Post a "Working on it..." placeholder. Returns the placeholder message ID. */
	postThinking(channel: string, threadId: string): Promise<string | null>;

	/** Update an existing message in-place. */
	updateMessage(channel: string, messageId: string, text: string): Promise<void>;

	/** Update a message and append feedback buttons. */
	updateWithFeedback(channel: string, messageId: string, text: string): Promise<void>;

	/** Add an emoji reaction to a message. */
	addReaction(channel: string, messageId: string, emoji: string): Promise<void>;

	/** Remove an emoji reaction from a message. */
	removeReaction(channel: string, messageId: string, emoji: string): Promise<void>;

	/** Register a handler for emoji reaction events. */
	onReaction(handler: ReactionHandler): void;

	/** Get the configured owner user ID, or null. */
	getOwnerUserId(): string | null;

	/** Set the phantom's display name (used in rejection messages). */
	setPhantomName(name: string): void;

	/** Whether the channel is currently connected. */
	isConnected(): boolean;
}
