/**
 * Discord owner profiling for onboarding.
 * Fetches guild member info, roles, and server name to build an OwnerProfile.
 */

import type { Client } from "discord.js";
import type { OwnerProfile } from "./profiler.ts";

/**
 * Fetch the owner's Discord profile, guild name, and visible channels.
 * All API calls are best-effort - failures degrade gracefully to null fields.
 */
export async function profileDiscordOwner(client: Client, guildId: string, ownerUserId: string): Promise<OwnerProfile> {
	const [guild, member] = await Promise.all([
		client.guilds.fetch(guildId).catch(() => null),
		client.guilds
			.fetch(guildId)
			.then((g) => g.members.fetch(ownerUserId))
			.catch(() => null),
	]);

	const displayName = member?.displayName ?? member?.user?.username ?? "there";
	const roles = member?.roles.cache.filter((r) => r.name !== "@everyone").map((r) => r.name) ?? [];

	// Use top role as a rough "title" equivalent
	const topRole = roles.length > 0 ? roles[0] : null;

	// Get text channel names the member can see
	const channels: string[] = [];
	if (guild) {
		try {
			const guildChannels = await guild.channels.fetch();
			for (const [, ch] of guildChannels) {
				if (ch?.isTextBased() && "name" in ch && ch.name) {
					channels.push(ch.name);
				}
			}
		} catch {
			// Best effort
		}
	}

	return {
		name: displayName,
		title: topRole,
		timezone: null, // Discord doesn't expose timezone
		status: null, // Discord doesn't expose custom status via bot API
		isAdmin: member?.permissions.has("Administrator") ?? false,
		isOwner: guild?.ownerId === ownerUserId,
		teamName: guild?.name ?? null,
		channels: channels.slice(0, 100),
	};
}
