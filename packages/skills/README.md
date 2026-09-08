# @griha/skills

Canonical store of Griha agent skills (agentskills.io layout).

## Content

- `skills/<name>/SKILL.md`

## API

- `getSkillsRoot()`
- `discoverSkills(rootDir?)`
- `formatSkillsForPrompt(skills)`

Agent runtime must use this package; do not keep a parallel `skills/` tree in `apps/agent`.
