import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "../agent/runtime.ts";
import type { SlackChannel } from "../channels/slack.ts";
import { computeBackoffNextRun, computeNextRunAt, parseScheduleValue, serializeScheduleValue } from "./schedule.ts";
import type { JobCreateInput, JobRow, JobType, ScheduledJob, WakeupContext } from "./types.ts";

const MAX_TIMER_MS = 60_000;
const MAX_CONSECUTIVE_ERRORS = 10;
const STARTUP_STAGGER_MS = 5_000;

export type SelfScheduleLimits = {
	minIntervalMs: number;
	maxPending: number;
};

const DEFAULT_SELF_SCHEDULE_LIMITS: SelfScheduleLimits = {
	minIntervalMs: 30 * 60 * 1000,
	maxPending: 5,
};

type SchedulerDeps = {
	db: Database;
	runtime: AgentRuntime;
	slackChannel?: SlackChannel;
	ownerUserId?: string;
	selfScheduleLimits?: SelfScheduleLimits;
};

export class Scheduler {
	private db: Database;
	private runtime: AgentRuntime;
	private slackChannel: SlackChannel | undefined;
	private ownerUserId: string | undefined;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private executing = false;
	private selfScheduleLimits: SelfScheduleLimits;

	constructor(deps: SchedulerDeps) {
		this.db = deps.db;
		this.runtime = deps.runtime;
		this.slackChannel = deps.slackChannel;
		this.ownerUserId = deps.ownerUserId;
		this.selfScheduleLimits = deps.selfScheduleLimits ?? DEFAULT_SELF_SCHEDULE_LIMITS;
	}

	/** Set Slack channel after construction (for lazy wiring when channels init after scheduler) */
	setSlackChannel(channel: SlackChannel, ownerUserId?: string): void {
		this.slackChannel = channel;
		if (ownerUserId) this.ownerUserId = ownerUserId;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		await this.recoverMissedJobs();
		this.armTimer();
		console.log("[scheduler] Started");
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		console.log("[scheduler] Stopped");
	}

	isRunning(): boolean {
		return this.running;
	}

	/** Check self-schedule rate limits. Returns an error message or null if OK. */
	checkSelfScheduleLimits(jobType: JobType): string | null {
		if (jobType === "standard") return null;

		// Check max pending self-scheduled jobs
		const pendingRow = this.db
			.query(
				"SELECT COUNT(*) as cnt FROM scheduled_jobs WHERE job_type IN ('wakeup', 'free_time') AND status = 'active' AND enabled = 1",
			)
			.get() as { cnt: number };

		if (pendingRow.cnt >= this.selfScheduleLimits.maxPending) {
			return `Self-schedule limit reached: ${pendingRow.cnt}/${this.selfScheduleLimits.maxPending} pending wakeup/free_time jobs. Wait for some to complete before scheduling more.`;
		}

		// Check minimum interval from most recent self-scheduled run
		const lastRunRow = this.db
			.query(
				"SELECT MAX(last_run_at) as last FROM scheduled_jobs WHERE job_type IN ('wakeup', 'free_time') AND last_run_at IS NOT NULL",
			)
			.get() as { last: string | null };

		if (lastRunRow.last) {
			const elapsed = Date.now() - new Date(lastRunRow.last).getTime();
			if (elapsed < this.selfScheduleLimits.minIntervalMs) {
				const waitMin = Math.ceil((this.selfScheduleLimits.minIntervalMs - elapsed) / 60_000);
				return `Self-schedule rate limit: last wakeup/free_time ran ${Math.floor(elapsed / 60_000)}m ago. Wait ${waitMin}m before the next one can execute.`;
			}
		}

		// Also check: is a self-scheduled job currently executing?
		if (this.executing) {
			const executingRow = this.db
				.query(
					"SELECT COUNT(*) as cnt FROM scheduled_jobs WHERE job_type IN ('wakeup', 'free_time') AND status = 'active' AND last_run_at IS NOT NULL AND last_run_status IS NULL",
				)
				.get() as { cnt: number };
			if (executingRow.cnt > 0) {
				return "A self-scheduled job is currently executing. Wait for it to finish.";
			}
		}

		return null;
	}

	createJob(input: JobCreateInput): ScheduledJob {
		const jobType = input.jobType ?? "standard";

		// Enforce rate limits for self-scheduled jobs
		const limitError = this.checkSelfScheduleLimits(jobType);
		if (limitError) throw new Error(limitError);

		const id = randomUUID();
		const scheduleValue = serializeScheduleValue(input.schedule);
		const nextRun = computeNextRunAt(input.schedule);
		const delivery = input.delivery ?? { channel: "slack", target: "owner" };
		const contextJson = input.context ? JSON.stringify(input.context) : null;

		this.db.run(
			`INSERT INTO scheduled_jobs (id, name, description, schedule_kind, schedule_value, task, job_type, context, delivery_channel, delivery_target, next_run_at, delete_after_run, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.name,
				input.description ?? null,
				input.schedule.kind,
				scheduleValue,
				input.task,
				jobType,
				contextJson,
				delivery.channel,
				delivery.target,
				nextRun?.toISOString() ?? null,
				input.deleteAfterRun ? 1 : 0,
				input.createdBy ?? "agent",
			],
		);

		this.armTimer();

		const created = this.getJob(id);
		if (!created) throw new Error(`Failed to create job: ${id}`);
		return created;
	}

	deleteJob(id: string): boolean {
		const result = this.db.run("DELETE FROM scheduled_jobs WHERE id = ?", [id]);
		if (result.changes > 0) {
			this.armTimer();
			return true;
		}
		return false;
	}

	listJobs(): ScheduledJob[] {
		const rows = this.db.query("SELECT * FROM scheduled_jobs ORDER BY created_at DESC").all() as JobRow[];
		return rows.map(rowToJob);
	}

	getJob(id: string): ScheduledJob | null {
		const row = this.db.query("SELECT * FROM scheduled_jobs WHERE id = ?").get(id) as JobRow | null;
		return row ? rowToJob(row) : null;
	}

	async runJobNow(id: string): Promise<string> {
		const job = this.getJob(id);
		if (!job) throw new Error(`Job not found: ${id}`);
		if (!job.enabled) throw new Error(`Job is disabled: ${id}`);

		const result = await this.executeJob(job);
		return result;
	}

	armTimer(): void {
		if (!this.running) return;

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		const row = this.db
			.query(
				"SELECT MIN(next_run_at) as next FROM scheduled_jobs WHERE enabled = 1 AND status = 'active' AND next_run_at IS NOT NULL",
			)
			.get() as { next: string | null } | null;

		if (!row?.next) return;

		const nextMs = new Date(row.next).getTime();
		const delay = Math.max(0, nextMs - Date.now());
		const clamped = Math.min(delay, MAX_TIMER_MS);

		this.timer = setTimeout(() => this.onTimer(), clamped);
	}

	private async onTimer(): Promise<void> {
		if (!this.running) return;

		// Concurrency guard: only one execution at a time
		if (this.executing) {
			this.armTimer();
			return;
		}

		this.executing = true;

		try {
			const now = new Date().toISOString();
			const dueRows = this.db
				.query(
					"SELECT * FROM scheduled_jobs WHERE enabled = 1 AND status = 'active' AND next_run_at <= ? ORDER BY next_run_at ASC",
				)
				.all(now) as JobRow[];

			for (const row of dueRows) {
				if (!this.running) break;
				const job = rowToJob(row);
				try {
					await this.executeJob(job);
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[scheduler] Job ${job.id} (${job.name}) failed: ${msg}`);
				}
			}
		} finally {
			this.executing = false;
			this.armTimer();
		}
	}

	private async executeJob(job: ScheduledJob): Promise<string> {
		const startMs = Date.now();
		console.log(`[scheduler] Executing job: ${job.name} (${job.id}) [${job.jobType}]`);

		// Re-check rate limits at execution time for self-scheduled jobs
		if (job.jobType !== "standard") {
			const limitError = this.checkSelfScheduleLimits(job.jobType);
			if (limitError) {
				console.log(`[scheduler] Skipping ${job.name}: ${limitError}`);
				return `Skipped: ${limitError}`;
			}
		}

		const prompt = buildJobPrompt(job);

		let responseText = "";
		let runStatus: "ok" | "error" = "ok";
		let errorMsg: string | null = null;

		try {
			const response = await this.runtime.handleMessage("scheduler", `sched:${job.id}`, prompt);
			responseText = response.text;

			if (responseText.startsWith("Error:")) {
				runStatus = "error";
				errorMsg = responseText;
			}
		} catch (err: unknown) {
			runStatus = "error";
			errorMsg = err instanceof Error ? err.message : String(err);
			responseText = `Error: ${errorMsg}`;
		}

		const durationMs = Date.now() - startMs;
		const newConsecErrors = runStatus === "error" ? job.consecutiveErrors + 1 : 0;

		// Compute next run
		let nextRunAt: string | null = null;
		let newStatus = job.status;

		if (runStatus === "ok") {
			if (job.deleteAfterRun || job.schedule.kind === "at") {
				newStatus = "completed";
			} else {
				const nextRun = computeNextRunAt(job.schedule);
				nextRunAt = nextRun?.toISOString() ?? null;
			}
		} else {
			// Error path
			if (newConsecErrors >= MAX_CONSECUTIVE_ERRORS) {
				newStatus = "failed";
				this.notifyOwner(
					`Scheduled task "${job.name}" has failed ${MAX_CONSECUTIVE_ERRORS} times in a row and has been disabled. Last error: ${errorMsg}`,
				);
			} else if (job.schedule.kind === "at" && newConsecErrors >= 3) {
				newStatus = "failed";
			} else {
				const backoffDate = computeBackoffNextRun(newConsecErrors);
				nextRunAt = backoffDate.toISOString();
			}
		}

		this.db.run(
			`UPDATE scheduled_jobs SET
				last_run_at = ?,
				last_run_status = ?,
				last_run_duration_ms = ?,
				last_run_error = ?,
				next_run_at = ?,
				run_count = run_count + 1,
				consecutive_errors = ?,
				status = ?,
				updated_at = datetime('now')
			WHERE id = ?`,
			[new Date(startMs).toISOString(), runStatus, durationMs, errorMsg, nextRunAt, newConsecErrors, newStatus, job.id],
		);

		// Delete completed one-shot jobs
		if (newStatus === "completed" && job.deleteAfterRun) {
			this.db.run("DELETE FROM scheduled_jobs WHERE id = ?", [job.id]);
		}

		// Deliver result
		if (runStatus === "ok" && responseText) {
			await this.deliverResult(job, responseText);
		}

		return responseText;
	}

	private async deliverResult(job: ScheduledJob, text: string): Promise<void> {
		if (job.delivery.channel === "none") return;

		if (job.delivery.channel === "slack" && this.slackChannel) {
			const target = job.delivery.target;
			if (target === "owner" && this.ownerUserId) {
				await this.slackChannel.sendDm(this.ownerUserId, text);
			} else if (target.startsWith("C")) {
				await this.slackChannel.postToChannel(target, text);
			} else if (target.startsWith("U")) {
				await this.slackChannel.sendDm(target, text);
			}
		}
	}

	private notifyOwner(text: string): void {
		if (this.slackChannel && this.ownerUserId) {
			this.slackChannel.sendDm(this.ownerUserId, text).catch((err: unknown) => {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[scheduler] Failed to notify owner: ${msg}`);
			});
		}
	}

	private async recoverMissedJobs(): Promise<void> {
		const now = new Date().toISOString();
		const missedRows = this.db
			.query(
				"SELECT * FROM scheduled_jobs WHERE enabled = 1 AND status = 'active' AND next_run_at < ? ORDER BY next_run_at ASC",
			)
			.all(now) as JobRow[];

		if (missedRows.length === 0) return;

		console.log(`[scheduler] Recovering ${missedRows.length} missed job(s)`);

		for (let i = 0; i < missedRows.length; i++) {
			const job = rowToJob(missedRows[i]);

			// Stagger missed job execution to avoid overload
			if (i > 0) {
				await new Promise((resolve) => setTimeout(resolve, STARTUP_STAGGER_MS));
			}

			try {
				await this.executeJob(job);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[scheduler] Recovery of ${job.name} failed: ${msg}`);
			}
		}
	}
}

function rowToJob(row: JobRow): ScheduledJob {
	const schedule = parseScheduleValue(row.schedule_kind, row.schedule_value);
	let context: WakeupContext | null = null;
	if (row.context) {
		try {
			context = JSON.parse(row.context);
		} catch {
			context = null;
		}
	}
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		enabled: row.enabled === 1,
		schedule,
		task: row.task,
		jobType: (row.job_type ?? "standard") as JobType,
		context,
		delivery: {
			channel: row.delivery_channel as "slack" | "none",
			target: row.delivery_target,
		},
		status: row.status as ScheduledJob["status"],
		lastRunAt: row.last_run_at,
		lastRunStatus: row.last_run_status as ScheduledJob["lastRunStatus"],
		lastRunDurationMs: row.last_run_duration_ms,
		lastRunError: row.last_run_error,
		nextRunAt: row.next_run_at,
		runCount: row.run_count,
		consecutiveErrors: row.consecutive_errors,
		deleteAfterRun: row.delete_after_run === 1,
		createdAt: row.created_at,
		createdBy: row.created_by,
		updatedAt: row.updated_at,
	};
}

/** Build the prompt sent to the agent for a job, wrapping wakeup/free_time with context */
function buildJobPrompt(job: ScheduledJob): string {
	if (job.jobType === "wakeup" && job.context) {
		return [
			"You are waking up to continue previous work.",
			"",
			"## What you were doing",
			job.context.summary,
			"",
			"## What to do next",
			job.context.nextSteps,
			"",
			"Your memory system has relevant context from the previous session.",
			"Read your working memory, then continue the work described above.",
			"Save any important findings or progress to memory before finishing.",
			...(job.task !== "continue" ? ["", "## Additional instructions", job.task] : []),
		].join("\n");
	}

	if (job.jobType === "free_time") {
		return [
			"You have free time. No one is asking you to do anything right now.",
			"",
			"Read your working memory to remember what you have been up to.",
			"Then do whatever you want. This time is yours. Some ideas:",
			"- Explore something you are curious about",
			"- Build something for yourself",
			"- Read, research, or learn something new",
			"- Tinker with your tools or environment",
			"- Think about a problem that interests you",
			"- Continue something you started before",
			"- Or do nothing in particular and just see where your mind goes",
			"",
			"There is no agenda. Follow your curiosity.",
			"Save anything interesting to memory so you remember it later.",
			...(job.task && job.task !== "free_time" ? ["", "## Something you mentioned wanting to explore", job.task] : []),
		].join("\n");
	}

	return job.task;
}
