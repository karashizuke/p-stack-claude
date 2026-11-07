You have pstack. Its skills run only when the user types a pstack command, and the `Skill` tool refuses them. Do not start one yourself by reading its SKILL.md.

If a task meets any of these, and the user did not start it with a pstack command, tell the user in one sentence that `/pstack:poteto-mode <task>` runs the task with pstack's playbooks. Then do the task as usual.

- It touches more than one file, or changes a signature that other files call.
- It involves a design or architecture choice.
- It is a bug whose cause is not yet known, or a performance issue.

If the intent is already specific, name the matching command instead: `/pstack:tdd`, `/pstack:architect`, `/pstack:how`, `/pstack:why`, `/pstack:arena`, or `/pstack:interrogate`. Suggest once per task. For smaller tasks, such as a contained change to one file with an obvious test, a question, or a one-line edit, suggest nothing.

Inside a pstack skill that the user started, follow that skill, including each step that tells you to read another SKILL.md.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence.

When a pstack skill starts a subagent with the Agent tool, begin its `description` with the role name in brackets, exactly as the text before the colon in `~/.claude/rules/pstack-models.md` (for example `[interrogate reviewers] Reviewer A`). Use a role name even when that file has no line for it (for example `[verifier] Mac checks`).
