# Task Protocol

## 1. Plan
For every milestone:
- identify sub-tasks
- define dependencies
- define acceptance criteria per task
- choose the default executor

## 2. Select next task
Always pick the next unblocked task automatically.

Task card must include:
- task_id
- goal
- file scope
- acceptance criteria
- recommended commands
- chosen executor

## 3. Execute
Local executor should:
- inspect relevant code
- edit only files needed for the task
- run commands required for validation
- capture relevant logs and screenshots

## 4. Check
Always run the deterministic check script after implementation attempts.

## 5. Package artifacts
Write an artifact packet with:
- task metadata
- files changed
- commands run
- summarized results
- failing logs summary
- screenshot paths if relevant
- proposed next step

## 6. Review
Planner decides one of:
- approve
- revise
- replan
- escalate_executor
- blocked

## 7. Update memory
After approval, write a memory update with:
- what changed
- why it changed
- unresolved issues
- recommended next task

## 8. Retry policy
- local retry budget: 2
- then replan or switch local executor
- do not loop forever on the same failure

## 9. Human escalation
Allowed only for:
- missing credential/secret
- undefined product behavior
- external outage
- decision that genuinely requires owner input
