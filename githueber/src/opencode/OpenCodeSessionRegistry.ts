import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentSessionRecord } from "../models/types.ts";

export interface PersistedOpenCodeSessionRecord extends AgentSessionRecord {
  endpoint: string;
  updatedAt: string;
}

/**
 * Stores the issue-to-session mapping needed to restore daemon-managed OpenCode sessions.
 *
 * Fields:
 * - `filePath`: absolute JSON file path used as the durable registry backing store
 */
export class OpenCodeSessionRegistry {
  constructor(private readonly filePath: string) {}

  /**
   * Returns the persisted session table, or an empty list when the registry does not exist yet.
   *
   * Side effects: reads and parses the registry JSON file when it exists.
   */
  load(): PersistedOpenCodeSessionRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as PersistedOpenCodeSessionRecord[]) : [];
  }

  /**
   * Replaces the full persisted table in one write.
   *
   * Side effects: creates the parent directory when needed and overwrites the registry JSON file.
   */
  replace(records: PersistedOpenCodeSessionRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(records, null, 2)}\n`);
  }

  /**
   * Upserts one persisted session record by session id.
   *
   * Side effects: reads the current registry contents and rewrites the registry JSON file.
   */
  upsert(record: PersistedOpenCodeSessionRecord): void {
    const records = this.load().filter((entry) => entry.sessionId !== record.sessionId);
    records.push(record);
    this.replace(records);
  }

  /**
   * Removes one persisted session record by session id.
   *
   * Side effects: reads the current registry contents and rewrites the registry JSON file.
   */
  remove(sessionId: string): void {
    this.replace(this.load().filter((entry) => entry.sessionId !== sessionId));
  }
}
