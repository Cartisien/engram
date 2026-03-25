# PROJECT_SPEC: Engram / Memory SDK Development Loop

## Product context

Engram / Memory SDK is a memory layer for agents. The system should support extraction, normalization, contradiction handling, temporal awareness, retrieval, evaluation, and developer-friendly workflows.

## Current development objective

Use OpenClaw in a planner/worker loop where:
- Opus performs thinking, planning, critique, and milestone review
- the Alienware machine performs local coding and execution
- the local executor handles routine development work to reduce token spend
- the loop updates memory after each approved task
- the human is removed from routine task routing

## Active milestone template

Replace this section per project iteration:

### Milestone
Improve Engram / Memory SDK developer loop and task autonomy.

### Desired outcomes
- task decomposition is consistent
- local executor performs coding and testing
- artifact packets are produced after each cycle
- memory updates are captured after each approved task
- replanning happens automatically after repeated failures
- human escalation happens only on true blockers

### Acceptance criteria
- OpenClaw can read repo instructions and start work from the prompt
- the worker executes local commands through the check runner
- artifact packets are machine-readable and consistent
- tasks move forward without requiring routine user decisions
- memory updates describe what changed, why, unresolved issues, and next recommended task

### Non-goals
- replacing Opus with a local planner
- making every model call local
- introducing broad infra changes not required for the current milestone
