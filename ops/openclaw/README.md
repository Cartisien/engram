# Engram / Memory SDK OpenClaw Dev Loop

This bundle sets up OpenClaw to run a planner/worker development loop for Engram and Memory SDK:

- **Planner / reviewer:** Anthropic Opus
- **Executor:** local coding model on the Alienware (prefer Devstral Small 2 or Qwen coder)
- **Truth:** deterministic checks from `run_checks.sh`
- **Human escalation:** only for real ambiguity, missing credentials, or external blockers

## Recommended placement

Put this bundle inside the repo being worked on:

```text
repo-root/
  ops/
    openclaw/
      MISSION_PROMPT.txt
      AGENT.md
      PROJECT_SPEC.md
      TASK_PROTOCOL.md
      STATE_MACHINE.md
      MODEL_ROUTING.json
      MEMORY_UPDATE_TEMPLATE.json
      ARTIFACT_PACKET.schema.json
      run_checks.sh
```

## How to use

1. Copy these files into `ops/openclaw/` inside the target repo.
2. Update `PROJECT_SPEC.md` with the current milestone or product objective.
3. Update `MODEL_ROUTING.json` with your actual local model endpoint names.
4. Update `run_checks.sh` with the commands the repo actually uses.
5. Paste `MISSION_PROMPT.txt` into OpenClaw as the top-level operating order.

## Core loop

`Opus plan -> local coder executes -> checks run -> artifact packet -> Opus review -> next task`

Use Opus only for:
- planning
- critique
- milestone review
- replanning after repeated failures

Keep local execution for:
- code edits
- repo search
- build/test loops
- screenshots
- retry cycles
