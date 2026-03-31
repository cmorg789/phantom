import { describe, expect, test } from "bun:test";
import { splitDiscordMessage, toDiscordMarkdown, truncateForDiscord } from "../discord-formatter.ts";

describe("toDiscordMarkdown", () => {
	test("passes through standard markdown unchanged", () => {
		const input = "**bold** *italic* ~~strike~~ [link](https://example.com)";
		expect(toDiscordMarkdown(input)).toBe(input);
	});

	test("preserves code blocks", () => {
		const input = "```ts\nconst x = 1;\n```";
		expect(toDiscordMarkdown(input)).toBe(input);
	});

	test("handles empty string", () => {
		expect(toDiscordMarkdown("")).toBe("");
	});
});

describe("truncateForDiscord", () => {
	test("returns short text unchanged", () => {
		expect(truncateForDiscord("hello")).toBe("hello");
	});

	test("truncates long text with notice", () => {
		const long = "a".repeat(2000);
		const result = truncateForDiscord(long, 100);
		expect(result.length).toBeLessThan(200);
		expect(result).toContain("Response truncated");
		expect(result).toContain("2000 characters");
	});

	test("uses default 1900 char limit", () => {
		const exactly1900 = "a".repeat(1900);
		expect(truncateForDiscord(exactly1900)).toBe(exactly1900);

		const over1900 = "a".repeat(1901);
		expect(truncateForDiscord(over1900)).toContain("Response truncated");
	});
});

describe("splitDiscordMessage", () => {
	test("returns single-element array for short text", () => {
		expect(splitDiscordMessage("hello")).toEqual(["hello"]);
	});

	test("splits at double newline boundary", () => {
		const part1 = "a".repeat(1000);
		const part2 = "b".repeat(1000);
		const text = `${part1}\n\n${part2}`;
		const chunks = splitDiscordMessage(text);
		expect(chunks.length).toBe(2);
		expect(chunks[0]).toBe(part1);
		expect(chunks[1]).toBe(part2);
	});

	test("splits at single newline when no double newline available", () => {
		const part1 = "a".repeat(1500);
		const part2 = "b".repeat(500);
		const text = `${part1}\n${part2}`;
		const chunks = splitDiscordMessage(text);
		expect(chunks.length).toBe(2);
	});

	test("handles text with no good split points", () => {
		const text = "a".repeat(4000);
		const chunks = splitDiscordMessage(text);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(1900);
		}
	});

	test("respects custom max length", () => {
		const text = "a".repeat(200);
		const chunks = splitDiscordMessage(text, 50);
		expect(chunks.length).toBeGreaterThan(1);
	});
});
