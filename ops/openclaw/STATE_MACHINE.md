# State Machine

```text
INTAKE
  -> PLAN
  -> SELECT_TASK
  -> EXECUTE
  -> RUN_CHECKS
  -> PACKAGE_ARTIFACTS
  -> REVIEW
     -> APPROVE -> UPDATE_MEMORY -> SELECT_TASK
     -> REVISE -> EXECUTE
     -> REPLAN -> PLAN
     -> ESCALATE_EXECUTOR -> SELECT_TASK
     -> BLOCKED -> HUMAN_ESCALATION
```

## State notes

### PLAN
Planner decomposes the active milestone into ordered tasks.

### SELECT_TASK
Choose the next unblocked task automatically.

### EXECUTE
Use the local executor for coding, file edits, repo search, and command execution.

### RUN_CHECKS
Use deterministic commands from `run_checks.sh`.

### PACKAGE_ARTIFACTS
Produce a compact, machine-readable artifact packet.

### REVIEW
Planner checks against acceptance criteria and check results.

### UPDATE_MEMORY
Write a memory summary after approved work.

### HUMAN_ESCALATION
Only when the blocker cannot be resolved autonomously.
