import { readFileSync } from "node:fs";
import type { DaemonConfig } from "../models/types.ts";
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

export class ConfigManager {
  private readonly config: DaemonConfig;

  constructor(configPath: string) {
    const file = readFileSync(configPath, "utf8");
    this.config = this.normalize(parseSimpleYaml(file));
  }

  private normalize(raw: ParsedConfig): DaemonConfig {
    const github = asObject(raw.github, "github");
    const labels = asObject(raw.labels, "labels");
    const execution = asObject(raw.execution, "execution");
    const polling = asObject(raw.polling ?? {}, "polling");
    const acp = asObject(raw.acp, "acp");
    const ipc = asObject(raw.ipc ?? {}, "ipc");
    const logging = asObject(raw.logging ?? {}, "logging");
    const agentMapping = asObject(raw.agent_mapping ?? {}, "agent_mapping");

    return {
      github: {
        repoOwner: asString(github.repo_owner, "github.repo_owner"),
        repoName: asString(github.repo_name, "github.repo_name"),
        targetRepoPath: asString(github.local_repo_path, "github.local_repo_path")
      },
      labels: {
        queue: asString(labels.queue_label, "labels.queue_label"),
        processing: asString(labels.processing_label, "labels.processing_label"),
        awaitPlan: asString(labels.await_plan_label, "labels.await_plan_label"),
        completed: asString(labels.completed_label, "labels.completed_label"),
        failed: asString(labels.failed_label, "labels.failed_label"),
        revising: asString(labels.revising_label, "labels.revising_label")
      },
      agentMapping: Object.fromEntries(
        Object.entries(agentMapping).map(([label, agent]) => [label, asString(agent, `agent_mapping.${label}`)])
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

  public getRepoOwner(): string {
    return this.config.github.repoOwner;
  }

  public getRepoName(): string {
    return this.config.github.repoName;
  }

  public getTargetRepoPath(): string {
    return this.config.github.targetRepoPath;
  }

  public getPollingIntervalMs(): number {
    return this.config.polling.intervalMs;
  }

  public getApprovalComment(): string {
    return this.config.execution.approvalComment;
  }

  public getReviseComment(): string {
    return this.config.execution.reviseComment;
  }

  public getSocketPath(): string {
    return this.config.ipc.socketPath;
  }

  public getACPConfiguration(): DaemonConfig["acp"] {
    return this.config.acp;
  }

  public getLabels(): DaemonConfig["labels"] {
    return this.config.labels;
  }

  public getAgentRoutingRules(): Array<{ label: string; agent: string }> {
    return Object.entries(this.config.agentMapping).map(([label, agent]) => ({ label, agent }));
  }
}
