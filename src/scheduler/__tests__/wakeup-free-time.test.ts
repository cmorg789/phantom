import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { runMigrations } from "../../db/migrate.ts";
import { Scheduler } from "../service.ts";

function createMockRuntime() {
	return {
		handleMessage: mock(async (_channel: string, _conversationId: string, _text: string) => ({
			text: "Mock agent response",
			sessionId: "mock-session",
			cost: { totalUsd: 0.01, inputTokens: 100, outputTokens: 50, modelUsage: {} },
			durationMs: 500,
		})),
		setMemoryContextBuilder: mock(() => {}),
		setEvolvedConfig: mock(() => {}),
		setRoleTemplate: mock(() => {}),
		setOnboardingPrompt: mock(() => {}),
		setMcpServers: mock(() => {}),
		getLastTrackedFiles: mock(() => []),
		getActiveSessionCount: mock(() => 0),
	};
}

function createMockSlackChannel() {
	return {
		sendDm: mock(async (_userId: string, _text: string) => "mock-ts"),
		postToChannel: mock(async (_channelId: string, _text: string) => "mock-ts"),
	};
}

describe("Wakeup jobs", () => {
	let db: Database;
	let mockRuntime: ReturnType<typeof createMockRuntime>;

	beforeAll(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
	});

	beforeEach(() => {
		db.run("DELETE FROM scheduled_jobs");
		mockRuntime = createMockRuntime();
	});

	afterAll(() => {
		db.close();
	});

	test("createJob with wakeup type stores context", () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Continue refactor",
			schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
			task: "continue",
			jobType: "wakeup",
			context: {
				summary: "Refactoring the auth middleware to use JWT tokens",
				nextSteps: "Finish the token validation logic and update the tests",
			},
			deleteAfterRun: true,
		});

		expect(job.jobType).toBe("wakeup");
		expect(job.context).not.toBeNull();
		expect(job.context?.summary).toBe("Refactoring the auth middleware to use JWT tokens");
		expect(job.context?.nextSteps).toBe("Finish the token validation logic and update the tests");
	});

	test("wakeup job persists and reloads context from DB", () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const created = scheduler.createJob({
			name: "Persist wakeup",
			schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
			task: "continue",
			jobType: "wakeup",
			context: {
				summary: "Building a dashboard page",
				nextSteps: "Add the chart component",
			},
		});

		const loaded = scheduler.getJob(created.id);
		expect(loaded?.jobType).toBe("wakeup");
		expect(loaded?.context?.summary).toBe("Building a dashboard page");
		expect(loaded?.context?.nextSteps).toBe("Add the chart component");
	});

	test("wakeup job execution passes wrapped prompt to runtime", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Wakeup test",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "continue",
			jobType: "wakeup",
			context: {
				summary: "Working on API endpoint",
				nextSteps: "Add error handling",
			},
		});

		await scheduler.runJobNow(job.id);

		const callArgs = mockRuntime.handleMessage.mock.calls[0];
		const prompt = callArgs[2];
		expect(prompt).toContain("You are waking up to continue previous work");
		expect(prompt).toContain("Working on API endpoint");
		expect(prompt).toContain("Add error handling");
		expect(prompt).not.toContain("## Additional instructions");
	});

	test("wakeup job with extra task includes additional instructions", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Wakeup with extras",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "Also check the CI pipeline",
			jobType: "wakeup",
			context: {
				summary: "Fixing flaky tests",
				nextSteps: "Run the full test suite",
			},
		});

		await scheduler.runJobNow(job.id);

		const prompt = mockRuntime.handleMessage.mock.calls[0][2];
		expect(prompt).toContain("## Additional instructions");
		expect(prompt).toContain("Also check the CI pipeline");
	});
});

describe("Free time jobs", () => {
	let db: Database;
	let mockRuntime: ReturnType<typeof createMockRuntime>;

	beforeAll(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
	});

	beforeEach(() => {
		db.run("DELETE FROM scheduled_jobs");
		mockRuntime = createMockRuntime();
	});

	afterAll(() => {
		db.close();
	});

	test("createJob with free_time type", () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Evening free time",
			schedule: { kind: "cron", expr: "0 22 * * *", tz: "America/Los_Angeles" },
			task: "free_time",
			jobType: "free_time",
		});

		expect(job.jobType).toBe("free_time");
		expect(job.context).toBeNull();
	});

	test("free_time job execution passes self-directed prompt", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Free time",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "free_time",
			jobType: "free_time",
		});

		await scheduler.runJobNow(job.id);

		const prompt = mockRuntime.handleMessage.mock.calls[0][2];
		expect(prompt).toContain("You have free time");
		expect(prompt).toContain("No one is asking you to do anything");
		expect(prompt).not.toContain("## Something you mentioned");
	});

	test("free_time job with suggested focus includes it in prompt", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Focused free time",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "Explore ways to improve the onboarding flow",
			jobType: "free_time",
		});

		await scheduler.runJobNow(job.id);

		const prompt = mockRuntime.handleMessage.mock.calls[0][2];
		expect(prompt).toContain("## Something you mentioned wanting to explore");
		expect(prompt).toContain("Explore ways to improve the onboarding flow");
	});

	test("free_time job delivers result to Slack", async () => {
		const mockSlack = createMockSlackChannel();
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			slackChannel: mockSlack as never,
			ownerUserId: "U_OWNER",
		});

		const job = scheduler.createJob({
			name: "Free time delivery",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "free_time",
			jobType: "free_time",
		});

		await scheduler.runJobNow(job.id);
		expect(mockSlack.sendDm).toHaveBeenCalledWith("U_OWNER", "Mock agent response");
	});
});

describe("Self-schedule rate limiting", () => {
	let db: Database;
	let mockRuntime: ReturnType<typeof createMockRuntime>;

	beforeAll(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
	});

	beforeEach(() => {
		db.run("DELETE FROM scheduled_jobs");
		mockRuntime = createMockRuntime();
	});

	afterAll(() => {
		db.close();
	});

	test("allows standard jobs without rate limits", () => {
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 60_000, maxPending: 1 },
		});

		// Create multiple standard jobs - should all succeed
		scheduler.createJob({ name: "S1", schedule: { kind: "every", intervalMs: 60_000 }, task: "T1" });
		scheduler.createJob({ name: "S2", schedule: { kind: "every", intervalMs: 60_000 }, task: "T2" });

		expect(scheduler.listJobs().length).toBe(2);
	});

	test("enforces max pending self-scheduled jobs", () => {
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 0, maxPending: 2 },
		});

		scheduler.createJob({
			name: "W1",
			schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
			task: "continue",
			jobType: "wakeup",
			context: { summary: "s", nextSteps: "n" },
		});

		scheduler.createJob({
			name: "F1",
			schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
			task: "free_time",
			jobType: "free_time",
		});

		// Third self-scheduled job should fail
		expect(() =>
			scheduler.createJob({
				name: "W2",
				schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
				task: "continue",
				jobType: "wakeup",
				context: { summary: "s", nextSteps: "n" },
			}),
		).toThrow("Self-schedule limit reached");
	});

	test("max pending limit does not count completed jobs", async () => {
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 0, maxPending: 1 },
		});

		const job = scheduler.createJob({
			name: "W1",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "continue",
			jobType: "wakeup",
			context: { summary: "s", nextSteps: "n" },
		});

		// Run it so it has a last_run_at (but stays active since it's recurring)
		await scheduler.runJobNow(job.id);

		// Delete it to free the slot
		scheduler.deleteJob(job.id);

		// Should now be able to create another
		const job2 = scheduler.createJob({
			name: "W2",
			schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
			task: "continue",
			jobType: "wakeup",
			context: { summary: "s2", nextSteps: "n2" },
		});

		expect(job2.jobType).toBe("wakeup");
	});

	test("enforces minimum interval between self-scheduled executions", async () => {
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 60 * 60 * 1000, maxPending: 10 },
		});

		// Create and run a wakeup job
		const job = scheduler.createJob({
			name: "W1",
			schedule: { kind: "every", intervalMs: 3_600_000 },
			task: "continue",
			jobType: "wakeup",
			context: { summary: "s", nextSteps: "n" },
		});

		await scheduler.runJobNow(job.id);

		// checkSelfScheduleLimits should now report rate limit
		const error = scheduler.checkSelfScheduleLimits("wakeup");
		expect(error).not.toBeNull();
		expect(error).toContain("Self-schedule rate limit");
	});

	test("standard jobs bypass rate limits entirely", () => {
		const error = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 999_999_999, maxPending: 0 },
		}).checkSelfScheduleLimits("standard");

		expect(error).toBeNull();
	});

	test("configurable limits are respected", () => {
		const scheduler = new Scheduler({
			db,
			runtime: mockRuntime as never,
			selfScheduleLimits: { minIntervalMs: 0, maxPending: 3 },
		});

		for (let i = 0; i < 3; i++) {
			scheduler.createJob({
				name: `FT${i}`,
				schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
				task: "free_time",
				jobType: "free_time",
			});
		}

		expect(() =>
			scheduler.createJob({
				name: "FT3",
				schedule: { kind: "at", at: new Date(Date.now() + 3_600_000).toISOString() },
				task: "free_time",
				jobType: "free_time",
			}),
		).toThrow("Self-schedule limit reached: 3/3");
	});
});

describe("buildJobPrompt (via executeJob)", () => {
	let db: Database;
	let mockRuntime: ReturnType<typeof createMockRuntime>;

	beforeAll(() => {
		db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run("PRAGMA foreign_keys = ON");
		runMigrations(db);
	});

	beforeEach(() => {
		db.run("DELETE FROM scheduled_jobs");
		mockRuntime = createMockRuntime();
	});

	afterAll(() => {
		db.close();
	});

	test("standard jobs pass task text directly", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		const job = scheduler.createJob({
			name: "Standard",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Tell me a joke",
		});

		await scheduler.runJobNow(job.id);

		const prompt = mockRuntime.handleMessage.mock.calls[0][2];
		expect(prompt).toBe("Tell me a joke");
	});

	test("wakeup without context falls back to task text", async () => {
		const scheduler = new Scheduler({ db, runtime: mockRuntime as never });

		// Manually insert a wakeup job without context (edge case)
		const job = scheduler.createJob({
			name: "No context wakeup",
			schedule: { kind: "every", intervalMs: 60_000 },
			task: "Just do something",
			jobType: "wakeup",
		});

		await scheduler.runJobNow(job.id);

		const prompt = mockRuntime.handleMessage.mock.calls[0][2];
		// Without context, wakeup falls through to raw task
		expect(prompt).toBe("Just do something");
	});
});
