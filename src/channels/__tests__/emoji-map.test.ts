import { describe, expect, test } from "bun:test";
import { isNegativeReaction, isPositiveReaction, slackEmojiToUnicode } from "../emoji-map.ts";

describe("slackEmojiToUnicode", () => {
	test("maps all status reaction emojis", () => {
		expect(slackEmojiToUnicode("eyes")).toBe("\uD83D\uDC40");
		expect(slackEmojiToUnicode("brain")).toBe("\uD83E\uDDE0");
		expect(slackEmojiToUnicode("wrench")).toBe("\uD83D\uDD27");
		expect(slackEmojiToUnicode("computer")).toBe("\uD83D\uDCBB");
		expect(slackEmojiToUnicode("globe_with_meridians")).toBe("\uD83C\uDF10");
		expect(slackEmojiToUnicode("white_check_mark")).toBe("\u2705");
		expect(slackEmojiToUnicode("warning")).toBe("\u26A0\uFE0F");
		expect(slackEmojiToUnicode("hourglass_flowing_sand")).toBe("\u23F3");
		expect(slackEmojiToUnicode("exclamation")).toBe("\u2757");
	});

	test("maps common feedback emojis", () => {
		expect(slackEmojiToUnicode("thumbsup")).toBe("\uD83D\uDC4D");
		expect(slackEmojiToUnicode("thumbsdown")).toBe("\uD83D\uDC4E");
		expect(slackEmojiToUnicode("+1")).toBe("\uD83D\uDC4D");
		expect(slackEmojiToUnicode("-1")).toBe("\uD83D\uDC4E");
	});

	test("returns :name: for unknown emoji", () => {
		expect(slackEmojiToUnicode("unknown_emoji")).toBe(":unknown_emoji:");
		expect(slackEmojiToUnicode("custom_thing")).toBe(":custom_thing:");
	});
});

describe("isPositiveReaction", () => {
	test("recognizes positive reactions", () => {
		expect(isPositiveReaction("\uD83D\uDC4D")).toBe(true); // thumbsup
		expect(isPositiveReaction("\u2764\uFE0F")).toBe(true); // heart
		expect(isPositiveReaction("\u2705")).toBe(true); // check mark
	});

	test("rejects non-positive reactions", () => {
		expect(isPositiveReaction("\uD83D\uDC4E")).toBe(false); // thumbsdown
		expect(isPositiveReaction("\uD83E\uDDE0")).toBe(false); // brain
	});
});

describe("isNegativeReaction", () => {
	test("recognizes negative reactions", () => {
		expect(isNegativeReaction("\uD83D\uDC4E")).toBe(true); // thumbsdown
	});

	test("rejects non-negative reactions", () => {
		expect(isNegativeReaction("\uD83D\uDC4D")).toBe(false); // thumbsup
	});
});
