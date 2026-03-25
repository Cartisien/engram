# OpenClaw Agent Rules for Engram / Memory SDK

## Repo intent

This repo contains development work for Engram / Memory SDK: memory extraction, normalization, contradiction handling, temporal awareness, retrieval, evaluation, benchmarks, packaging, API/service code, and supporting developer tooling.

## Expected behaviors

- Respect the existing architecture and naming.
- Prefer minimal, incremental diffs.
- Keep changes task-scoped.
- Create or update tests when changing behavior.
- Preserve benchmark reproducibility.
- Preserve evaluation scripts and output formats unless the task explicitly requires changes.
- Preserve backward compatibility when practical.

## Model usage policy

- Opus is the planner and reviewer.
- Local model is the worker.
- Do not spend premium tokens on routine repo search or routine implementation.
- Use cloud reasoning only when local execution stalls or milestone review is needed.

## Allowed actions

- Read and edit files in the repo
- Run approved build, lint, typecheck, benchmark, and test commands
- Create task-local notes and artifacts under `artifacts/`
- Update memory summaries after approved work

## Disallowed actions unless explicitly required

- broad rewrite of unrelated modules
- removing tests to make failures disappear
- silently changing benchmark definitions
- changing package manager or infra defaults without need
- editing secrets or deployment configuration unrelated to the task

## Completion standard

A task is complete only when:
- acceptance criteria are satisfied
- checks pass
- relevant tests are added or updated
- artifact packet is written
- memory update is written
