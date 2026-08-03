// Generated from tooling/zcode-workflow/agent-registry.mjs and zcode-market/agent-registry.json. Do not edit directly.
export const ZCODE_AGENT_BUNDLE_CONTRACT = "ZCODE_AGENT_BUNDLE_V2";
export const ZCODE_AGENT_BUNDLE_VERSION = "2.0.0";
export const ZCODE_AGENT_BUNDLE_DIGEST = "sha256:66671d068033e46fa5755570b8049db778ced2dc926c8032bd7a0794d4f3c72a";
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
export const ZCODE_AGENT_REGISTRY = deepFreeze({
  "$schema": "./agent-registry.schema.json",
  "contract": "ZCODE_AGENT_BUNDLE_V2",
  "bundle_version": "2.0.0",
  "source_repository": "Ghost233/ghost-agent-market",
  "template_root": "zcode-market/agent-templates",
  "allowed_custom_metadata": [
    "model",
    "color"
  ],
  "skills": [
    {
      "id": "ghost-agent-skills:git-commit",
      "plugin": "ghost-agent-skills",
      "path": "skills/git-commit",
      "operations": [
        "commit_authorized_changes"
      ],
      "consumers": [
        "git-commit"
      ]
    },
    {
      "id": "ghost-agent-skills:git-merge-conflict",
      "plugin": "ghost-agent-skills",
      "path": "skills/git-merge-conflict",
      "operations": [
        "resolve_high_risk_conflict"
      ],
      "consumers": [
        "git-merge-conflict"
      ]
    },
    {
      "id": "ghost-agent-workflow:workflow-bound-run",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-bound-run",
      "operations": [
        "execute_owner_run",
        "repair_owner_run",
        "review_implementation"
      ],
      "consumers": [
        "workflow-owner",
        "workflow-implementation-reviewer"
      ]
    },
    {
      "id": "ghost-agent-workflow:workflow-config",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-config",
      "operations": [
        "show_strict",
        "validate_strict",
        "init",
        "migrate",
        "set_parallel",
        "set_execution_class"
      ],
      "consumers": [
        "workflow-config-reader",
        "workflow-config-writer"
      ]
    },
    {
      "id": "ghost-agent-workflow:workflow-coordination",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-coordination",
      "operations": [],
      "consumers": []
    },
    {
      "id": "ghost-agent-workflow:workflow-dashboard",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-dashboard",
      "operations": [
        "start_dashboard",
        "read_dashboard_status",
        "stop_dashboard"
      ],
      "consumers": [
        "workflow-dashboard-starter",
        "workflow-dashboard-status-reader",
        "workflow-dashboard-stopper"
      ]
    },
    {
      "id": "ghost-agent-workflow:workflow-plan-review",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-plan-review",
      "operations": [
        "review_plan_revision"
      ],
      "consumers": [
        "workflow-plan-reviewer"
      ]
    },
    {
      "id": "ghost-agent-workflow:workflow-planning",
      "plugin": "ghost-agent-workflow",
      "path": "skills/workflow-planning",
      "operations": [
        "initial_plan",
        "revise_plan",
        "apply_global_delta",
        "expand_subgraph"
      ],
      "consumers": [
        "workflow-planner"
      ]
    }
  ],
  "agents": [
    {
      "id": "git-commit",
      "plugin": "ghost-agent-skills",
      "skill": "ghost-agent-skills:git-commit",
      "operations": [
        "commit_authorized_changes"
      ],
      "permission_class": "git_commit",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-skills/git-commit.md",
      "template_sha256": "sha256:f94ddffb16b4d8b650b87d4ca22c09b9e9bdb99bf90e7a71dc78588677894a60",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "git-merge-conflict",
      "plugin": "ghost-agent-skills",
      "skill": "ghost-agent-skills:git-merge-conflict",
      "operations": [
        "resolve_high_risk_conflict"
      ],
      "permission_class": "git_conflict_write",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-skills/git-merge-conflict.md",
      "template_sha256": "sha256:022eb013f2320ea64eb41f6d13e73ce4bc2639573dca53a3068afef1a474e625",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-config-reader",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-config",
      "operations": [
        "show_strict",
        "validate_strict"
      ],
      "permission_class": "config_read",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-workflow/workflow-config-reader.md",
      "template_sha256": "sha256:51052874411077c3498543920e7b33f85214986bc4c79d95e02e5b3de1bfc4fd",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-config-writer",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-config",
      "operations": [
        "init",
        "migrate",
        "set_parallel",
        "set_execution_class"
      ],
      "permission_class": "config_write",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-workflow/workflow-config-writer.md",
      "template_sha256": "sha256:4344f79451d2138e126dd8d5a6325bbffeb81e281352fc1fe5557291b4bc9989",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-dashboard-starter",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-dashboard",
      "operations": [
        "start_dashboard"
      ],
      "permission_class": "dashboard_start",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-workflow/workflow-dashboard-starter.md",
      "template_sha256": "sha256:0c98b4a6a4daf30d13cf690d372c06d03e084d85d15a356ea9f09e445a5d0e93",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-dashboard-status-reader",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-dashboard",
      "operations": [
        "read_dashboard_status"
      ],
      "permission_class": "dashboard_read",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-workflow/workflow-dashboard-status-reader.md",
      "template_sha256": "sha256:94508b6893b3f611c6b88824639dcb78831d9cb679f6462369ac91eb712ac339",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-dashboard-stopper",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-dashboard",
      "operations": [
        "stop_dashboard"
      ],
      "permission_class": "dashboard_stop",
      "execution_class": null,
      "execution_class_config_key": null,
      "template": "ghost-agent-workflow/workflow-dashboard-stopper.md",
      "template_sha256": "sha256:1db8feabbc72e1b96e3bd68ed555cabe33779ec59c9c80e702332e723b275e0c",
      "metadata_policy": {
        "model": "preserve_or_global",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-implementation-reviewer",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-bound-run",
      "operations": [
        "review_implementation"
      ],
      "permission_class": "workspace_review",
      "execution_class": "main",
      "execution_class_config_key": "review",
      "template": "ghost-agent-workflow/workflow-implementation-reviewer.md",
      "template_sha256": "sha256:0d485a704e6829eece4bb3021bc09e04b3b2845c20b795398fc962d46c1cc10d",
      "metadata_policy": {
        "model": "template_inherit",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-owner",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-bound-run",
      "operations": [
        "execute_owner_run",
        "repair_owner_run"
      ],
      "permission_class": "workspace_write",
      "execution_class": "main",
      "execution_class_config_key": "owner",
      "template": "ghost-agent-workflow/workflow-owner.md",
      "template_sha256": "sha256:72217be711a03b0d1323a312a719874a64a687fde9bab71590767a39bda664a4",
      "metadata_policy": {
        "model": "template_inherit",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-plan-reviewer",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-plan-review",
      "operations": [
        "review_plan_revision"
      ],
      "permission_class": "plan_review",
      "execution_class": "main",
      "execution_class_config_key": "planner_reviewer",
      "template": "ghost-agent-workflow/workflow-plan-reviewer.md",
      "template_sha256": "sha256:09e76bd46f6c26e8899298829a4ad0ca6f6888c363778a15e9e877c330137204",
      "metadata_policy": {
        "model": "template_inherit",
        "color": "preserve"
      }
    },
    {
      "id": "workflow-planner",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-planning",
      "operations": [
        "initial_plan",
        "revise_plan",
        "apply_global_delta",
        "expand_subgraph"
      ],
      "permission_class": "plan_write",
      "execution_class": "main",
      "execution_class_config_key": "planner",
      "template": "ghost-agent-workflow/workflow-planner.md",
      "template_sha256": "sha256:9848bddc048671587f4cae200e767c861eacbbf8f0f786a0028761b3a6f4f104",
      "metadata_policy": {
        "model": "template_inherit",
        "color": "preserve"
      }
    }
  ],
  "legacy_agents": [
    {
      "id": "git-commit",
      "replacements": [
        "git-commit"
      ],
      "remove": false
    },
    {
      "id": "git-merge-conflict",
      "replacements": [
        "git-merge-conflict"
      ],
      "remove": false
    },
    {
      "id": "parallel-task-planner",
      "replacements": [
        "workflow-planner"
      ],
      "remove": true
    },
    {
      "id": "planner-reviewer",
      "replacements": [
        "workflow-plan-reviewer"
      ],
      "remove": true
    },
    {
      "id": "setup-sub-thread-workflow",
      "replacements": [
        "workflow-config-reader",
        "workflow-config-writer"
      ],
      "remove": true
    },
    {
      "id": "start-dag-dashboard",
      "replacements": [
        "workflow-dashboard-starter",
        "workflow-dashboard-status-reader",
        "workflow-dashboard-stopper"
      ],
      "remove": true
    },
    {
      "id": "sub-thread-coordination",
      "replacements": [],
      "remove": true
    },
    {
      "id": "sub-thread-goal-worker",
      "replacements": [
        "workflow-owner",
        "workflow-implementation-reviewer"
      ],
      "remove": true
    }
  ]
});
export function agentForOperation(agentId, operation) {
  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);
  if (!agent || !agent.operations.includes(operation)) {
    throw new Error(`agent ${agentId} is not authorized for ${operation}`);
  }
  return agent;
}

export function resolveExecutionClass(agentId, workflowConfig) {
  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);
  if (!agent || agent.execution_class_config_key === null) return null;
  return workflowConfig.execution_classes[agent.execution_class_config_key];
}

export function assertAgentPermission(agentId, operation, permissionClass) {
  const agent = agentForOperation(agentId, operation);
  if (agent.permission_class !== permissionClass) {
    throw new Error(`permission mismatch for ${agentId}/${operation}`);
  }
  return agent;
}
