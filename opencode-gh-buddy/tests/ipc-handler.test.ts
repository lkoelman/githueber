import { describe, expect, test } from "bun:test";
import { handleIPCCommand } from "../src/ipc/handler.ts";

describe("handleIPCCommand", () => {
  test("returns repository-aware session records for the sessions command", async () => {
    const response = await handleIPCCommand(
      {
        getActiveSessions: () => [
          {
            sessionId: "ses-1",
            repositoryKey: "frontend",
            repoOwner: "acme",
            repoName: "frontend",
            issueNumber: 42,
            status: "RUNNING",
            agentName: "github-worker-agent"
          }
        ],
        stopSession: async () => {},
        triggerManualPoll: async () => {},
        updateConfig: () => {}
      },
      {
        command: "LIST_SESSIONS",
        payload: {}
      }
    );

    expect(response).toEqual({
      status: "ok",
      data: [
        {
          sessionId: "ses-1",
          repositoryKey: "frontend",
          repoOwner: "acme",
          repoName: "frontend",
          issueNumber: 42,
          status: "RUNNING",
          agentName: "github-worker-agent"
        }
      ]
    });
  });

  test("returns the manual poll summary for the poll command", async () => {
    const response = await handleIPCCommand(
      {
        getActiveSessions: () => [],
        stopSession: async () => {},
        triggerManualPoll: async () => ({
          repositories: [
            {
              repositoryKey: "frontend",
              fetchedIssues: [{ issueNumber: 42, title: "Test issue" }],
              dispatchedIssues: [
                {
                  issueNumber: 42,
                  title: "Test issue",
                  action: "START_SESSION",
                  agentName: "github-worker-agent"
                }
              ]
            }
          ]
        }),
        updateConfig: () => {}
      },
      {
        command: "TRIGGER_POLL",
        payload: {}
      }
    );

    expect(response).toEqual({
      status: "ok",
      message: "Manual poll completed.",
      data: {
        repositories: [
          {
            repositoryKey: "frontend",
            fetchedIssues: [{ issueNumber: 42, title: "Test issue" }],
            dispatchedIssues: [
              {
                issueNumber: 42,
                title: "Test issue",
                action: "START_SESSION",
                agentName: "github-worker-agent"
              }
            ]
          }
        ]
      }
    });
  });
});
