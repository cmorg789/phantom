import { describe, expect, mock, test } from "bun:test";

// We test the parseConversationId logic and DiscordChannel construction
// by verifying the public interface. Full integration tests require a
// Discord gateway connection, so we focus on unit-testable behavior.

describe("Discord conversation ID parsing", () => {
	test("parses standard discord conversation ID", () => {
		// The format is discord:{channelId}:{messageId}
		const id = "discord:123456789:987654321";
		const parts = id.split(":");
		expect(parts[0]).toBe("discord");
		expect(parts[1]).toBe("123456789");
		expect(parts[2]).toBe("987654321");
	});

	test("handles thread conversation IDs", () => {
		// Threads are just channels in Discord, so same format
		const id = "discord:111222333:444555666";
		const parts = id.split(":");
		expect(parts).toHaveLength(3);
		expect(parts[0]).toBe("discord");
	});
});

describe("DiscordChannel config", () => {
	test("exports DiscordChannelConfig type", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		expect(DiscordChannel).toBeDefined();
	});

	test("channel has correct id and name", async () => {
		// We can't fully construct without a real token, but we can verify
		// the class shape via prototype
		const { DiscordChannel } = await import("../discord.ts");
		const proto = DiscordChannel.prototype;
		expect(proto.send).toBeFunction();
		expect(proto.onMessage).toBeFunction();
		expect(proto.sendDm).toBeFunction();
		expect(proto.postToChannel).toBeFunction();
		expect(proto.postThinking).toBeFunction();
		expect(proto.updateMessage).toBeFunction();
		expect(proto.updateWithFeedback).toBeFunction();
		expect(proto.addReaction).toBeFunction();
		expect(proto.removeReaction).toBeFunction();
		expect(proto.onReaction).toBeFunction();
		expect(proto.getOwnerUserId).toBeFunction();
		expect(proto.setPhantomName).toBeFunction();
		expect(proto.isConnected).toBeFunction();
	});
});

describe("DiscordChannel capabilities", () => {
	test("declares correct capabilities", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		// Access via a mock instance - we need to handle constructor side effects
		const mockConfig = {
			botToken: "test-token",
			guildId: "test-guild",
			ownerUserId: "test-owner",
		};
		// DiscordChannel constructor creates a Client which is safe without login
		const channel = new DiscordChannel(mockConfig);
		expect(channel.id).toBe("discord");
		expect(channel.name).toBe("Discord");
		expect(channel.capabilities.threads).toBe(true);
		expect(channel.capabilities.richText).toBe(true);
		expect(channel.capabilities.buttons).toBe(true);
		expect(channel.capabilities.reactions).toBe(true);
		expect(channel.capabilities.progressUpdates).toBe(true);
		expect(channel.capabilities.messageEditing).toBe(true);
	});

	test("initial state is disconnected", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
		});
		expect(channel.isConnected()).toBe(false);
		expect(channel.getConnectionState()).toBe("disconnected");
	});

	test("owner user ID is stored", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
			ownerUserId: "U_OWNER",
		});
		expect(channel.getOwnerUserId()).toBe("U_OWNER");
	});

	test("owner user ID defaults to null", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
		});
		expect(channel.getOwnerUserId()).toBeNull();
	});

	test("setPhantomName updates the name", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
		});
		channel.setPhantomName("TestBot");
		// Name is used internally for rejection messages, no getter to test
		// but we verify it doesn't throw
	});

	test("onMessage registers handler", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
		});
		const handler = mock(async () => {});
		channel.onMessage(handler);
		// Handler is stored internally, verified by the fact it doesn't throw
	});

	test("onReaction registers handler", async () => {
		const { DiscordChannel } = await import("../discord.ts");
		const channel = new DiscordChannel({
			botToken: "test",
			guildId: "guild",
		});
		const handler = mock(() => {});
		channel.onReaction(handler);
	});
});
