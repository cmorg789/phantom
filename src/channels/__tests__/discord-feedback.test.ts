import { describe, expect, test } from "bun:test";
import { buildDiscordFeedbackAck, parseDiscordFeedbackId } from "../discord-feedback.ts";

describe("parseDiscordFeedbackId", () => {
	test("parses positive feedback", () => {
		const result = parseDiscordFeedbackId("phantom:feedback:positive:msg123");
		expect(result).toEqual({ type: "positive", messageId: "msg123" });
	});

	test("parses negative feedback", () => {
		const result = parseDiscordFeedbackId("phantom:feedback:negative:msg456");
		expect(result).toEqual({ type: "negative", messageId: "msg456" });
	});

	test("parses partial feedback", () => {
		const result = parseDiscordFeedbackId("phantom:feedback:partial:msg789");
		expect(result).toEqual({ type: "partial", messageId: "msg789" });
	});

	test("returns null for non-feedback custom IDs", () => {
		expect(parseDiscordFeedbackId("phantom:action:0")).toBeNull();
		expect(parseDiscordFeedbackId("other:thing")).toBeNull();
		expect(parseDiscordFeedbackId("")).toBeNull();
	});

	test("returns null for invalid feedback type", () => {
		expect(parseDiscordFeedbackId("phantom:feedback:unknown:msg")).toBeNull();
	});

	test("returns null when messageId is missing", () => {
		expect(parseDiscordFeedbackId("phantom:feedback:positive")).toBeNull();
	});
});

describe("buildDiscordFeedbackAck", () => {
	test("returns ack for positive", () => {
		expect(buildDiscordFeedbackAck("positive")).toBe("*Thanks for the feedback!*");
	});

	test("returns ack for negative", () => {
		expect(buildDiscordFeedbackAck("negative")).toContain("try to do better");
	});

	test("returns ack for partial", () => {
		expect(buildDiscordFeedbackAck("partial")).toContain("work on improving");
	});

	test("returns generic ack for unknown type", () => {
		expect(buildDiscordFeedbackAck("other")).toBe("*Feedback recorded.*");
	});
});
