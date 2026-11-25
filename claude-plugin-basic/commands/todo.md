---
description: "To-dos in Knorky, tasks to tick off without time: /todo <title> adds one to this repository's project, /todo lists the open ones"
argument-hint: '[<title>]'
---

Use the Knorky MCP server's tools for this to-do command. Its arguments are:
`$ARGUMENTS`

Follow the `time-tracking` skill for this repository's project. Then act on
the arguments:

- **Empty:** call `list_tasks` in the project with `task_type` `"todo"`, and
  list the open to-dos, one per line. With none, answer:
  `No open to-dos in <project>. Add one: /todo <title>`
- **A title:** call `create_task` in the project with that title and
  `task_type` `"todo"`. Start no timer. Answer:
  `To-do added: <title> · <project>`

If no Knorky tools are available, say: `Knorky is not connected. Run /mcp,
choose plugin:knorky:knorky and sign in.`
