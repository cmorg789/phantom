import type { Database } from "bun:sqlite";
import type { Client as DiscordClient } from "discord.js";
import type { PrimaryChannel } from "../channels/primary-channel.ts";
import type { RoleTemplate } from "../roles/types.ts";
import { profileDiscordOwner } from "./discord-profiler.ts";
import { type OwnerProfile, type SlackProfileClient, hasPersonalizationData, profileOwner } from "./profiler.ts";
import { markOnboardingStarted } from "./state.ts";

export type OnboardingTarget = { type: "channel"; channelId: string } | { type: "dm"; userId: string };

export type ProfilerClient =
	| { type: "slack"; client: SlackProfileClient }
	| { type: "discord"; client: DiscordClient; guildId: string };

function buildGenericIntro(phantomName: string, _role: RoleTemplate): string {
	return [
		`Hey there. I'm ${phantomName}, just got spun up on my own machine.`,
		"",
		"I can dig into just about anything: research, code, data, writing, building tools," +
			" automating workflows. I learn from every conversation and get better over time.",
		"",
		"What are you working on? I'll start there.",
	].join("\n");
}

function buildPersonalizedIntro(phantomName: string, _role: RoleTemplate, profile: OwnerProfile): string {
	const parts: string[] = [];

	if (profile.teamName) {
		parts.push(
			`Hey ${profile.name}. I'm ${phantomName}, just got spun up on my own machine in the ${profile.teamName} workspace.`,
		);
	} else {
		parts.push(`Hey ${profile.name}. I'm ${phantomName}, just got spun up on my own machine.`);
	}

	parts.push("");
	parts.push(
		"I can dig into just about anything: research, code, data, writing, building tools," +
			" automating workflows. I learn from every conversation and get better over time.",
	);
	parts.push("");
	parts.push("What are you working on right now? I'll start there.");

	return parts.join("\n");
}

/**
 * Start the onboarding flow by profiling the owner and sending a personalized DM.
 * Falls back to generic intro if profiling fails or no owner is configured.
 */
export async function startOnboarding(
	channel: PrimaryChannel,
	target: OnboardingTarget,
	phantomName: string,
	role: RoleTemplate,
	db: Database,
	profilerClient?: ProfilerClient,
): Promise<OwnerProfile | null> {
	markOnboardingStarted(db);

	// Profile the owner for personalization if a profiler client is available
	let profile: OwnerProfile | null = null;
	if (target.type === "dm" && profilerClient) {
		try {
			if (profilerClient.type === "slack") {
				profile = await profileOwner(profilerClient.client, target.userId);
			} else {
				profile = await profileDiscordOwner(profilerClient.client, profilerClient.guildId, target.userId);
			}
			console.log(`[onboarding] Profiled owner: ${profile.name}${profile.title ? ` (${profile.title})` : ""}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[onboarding] Failed to profile owner: ${msg}. Using generic intro.`);
		}
	}

	const intro =
		profile !== null && hasPersonalizationData(profile)
			? buildPersonalizedIntro(phantomName, role, profile)
			: buildGenericIntro(phantomName, role);
	const hasUsefulProfile = profile !== null && hasPersonalizationData(profile);

	if (target.type === "dm") {
		await channel.sendDm(target.userId, intro);
		console.log(`[onboarding] Introduction sent as DM to user ${target.userId}`);
	} else {
		await channel.postToChannel(target.channelId, intro);
		console.log(`[onboarding] Introduction posted to channel ${target.channelId}`);
	}

	// Return profile only if it has useful data for onboarding prompt injection
	return hasUsefulProfile ? profile : null;
}
