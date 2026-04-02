import { readFileSync } from "node:fs";
import type { DaemonConfig, LabelConfig, RepositoryConfig } from "../models/types.ts";
import { parseSimpleYaml } from "../utils/simpleYaml.ts";

type ParsedConfig = Record<string, any>;

function asString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Expected non-empty string for ${key}`);
  }
  return value;
}

function asBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean for ${key}`);
  }
  return value;
}

function asNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected number for ${key}`);
  }
  return value;
}

function asObject(value: unknown, key: string): ParsedConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected mapping for ${key}`);
  }
  return value as ParsedConfig;
}

function normalizeLabels(raw: ParsedConfig, keyPrefix: string): LabelConfig {
  return {
    queue: asString(raw.queue_label, `${keyPrefix}.queue_label`),
    processing: asString(raw.processing_label, `${keyPrefix}.processing_label`),
    awaitPlan: asString(raw.await_plan_label, `${keyPrefix}.await_plan_label`),
    completed: asString(raw.completed_label, `${keyPrefix}.completed_label`),
    failed: asString(raw.failed_label, `${keyPrefix}.failed_label`),
    revising: asString(raw.revising_label, `${keyPrefix}.revising_label`)
  };
}

function normalizeRepository(key: string, raw: ParsedConfig): RepositoryConfig {
  const labels = asObject(raw.labels, `repositories.${key}.labels`);
  const agentMapping = asObject(raw.agent_mapping ?? {}, `repositories.${key}.agent_mapping`);

  return {
    key,
    owner: asString(raw.owner, `repositories.${key}.owner`),
    repo: asString(raw.repo, `repositories.${key}.repo`),
    localRepoPath: asString(raw.local_repo_path, `repositories.${key}.local_repo_path`),
    labels: normalizeLabels(labels, `repositories.${key}.labels`),
    agentMapping: Object.fromEntries(
      Object.entries(agentMapping).map(([label, agent]) => [label, asString(agent, `repositories.${key}.agent_mapping.${label}`)])
    )
  };
}

export class ConfigManager {
  private readonly config: DaemonConfig;

  constructor(configPath: string) {
    const file = readFileSync(configPath, "utf8");
    this.config = this.normalize(parseSimpleYaml(file));
  }

  private normalize(raw: ParsedConfig): DaemonConfig {
    const repositories = asObject(raw.repositories, "repositories");
    const execution = asObject(raw.execution, "execution");
    const polling = asObject(raw.polling ?? {}, "polling");
    const acp = asObject(raw.acp, "acp");
    const ipc = asObject(raw.ipc ?? {}, "ipc");
    const logging = asObject(raw.logging ?? {}, "logging");

    return {
      repositories: Object.fromEntries(
        Object.entries(repositories).map(([key, value]) => [key, normalizeRepository(key, asObject(value, `repositories.${key}`))])
      ),
      execution: {
        autoApprove: asBoolean(execution.auto_approve, "execution.auto_approve"),
        concurrency: asNumber(execution.concurrency, "execution.concurrency"),
        approvalComment: asString(execution.approval_comment, "execution.approval_comment"),
        reviseComment: asString(execution.revise_comment, "execution.revise_comment"),
        opencodeModel:
          execution.opencode_model === null
            ? null
            : asString(execution.opencode_model, "execution.opencode_model"),
        timeoutSeconds: asNumber(execution.timeout, "execution.timeout")
      },
      polling: {
        intervalMs: typeof polling.interval_ms === "number" ? polling.interval_ms : 300000
      },
      acp: {
        endpoint: asString(acp.endpoint, "acp.endpoint")
      },
      ipc: {
        socketPath:
          typeof ipc.socket_path === "string" && ipc.socket_path
            ? ipc.socket_path
            : "/tmp/opencode-gh-buddy.sock"
      },
      logging: {
        level: typeof logging.log_level === "string" && logging.log_level ? logging.log_level : "info"
      }
    };
  }

  public getConfig(): DaemonConfig {
    return this.config;
  }

  public updateValue(key: string, value: unknown): void {
    const [section, field] = key.split(".");
    if (!section || !field) {
      throw new Error(`Unsupported config key: ${key}`);
    }
    const target = this.config[section as keyof DaemonConfig] as Record<string, unknown>;
    if (!target || typeof target !== "object") {
      throw new Error(`Unsupported config section: ${section}`);
    }
    target[field] = value;
  }
}
