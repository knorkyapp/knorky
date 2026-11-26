# Knorky for ChatGPT and Codex

The package OpenAI's plugin directory takes, for ChatGPT and Codex: Knorky's
hosted MCP server (`https://api.knorky.com/mcp`), one skill with the rules
for using its tools well, and the listing and review details in
`plugin.json`. It has no hooks and runs no code. Users install it from the
plugin directory in ChatGPT or Codex and sign in with their Knorky account.

| File                            | What it is                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `plugin.json`                   | Name, listing text, icons, review test cases and release notes (Agent Plugins format) |
| `mcp.json`                      | The MCP server and how ChatGPT signs in: a client registered in Knorky's login server |
| `skills/time-tracking/SKILL.md` | How to find tasks, run timers, add to-dos, report time, and what never to do          |
| `assets/`                       | The logo and the composer icon (512 × 512 PNG)                                        |

## Sign-in

Knorky's login server (Logto) has no dynamic client registration, so ChatGPT
uses a client registered for it: a **Traditional web** application named
`ChatGPT`, with the redirect URI
`https://chatgpt.com/connector_platform_oauth_redirect` and **Always issue
Refresh Token** switched on. Its App ID is the `clientId` in `mcp.json`. Its App secret goes only into the portal's **OAuth Client
Secret** field, never into this folder.

## Submit

1. Build the ZIP from this folder's contents (the files at the ZIP's root):

   ```powershell
   Compress-Archive -Path openai-plugin\* -DestinationPath knorky-openai.zip -Force
   ```

2. https://platform.openai.com/plugins → **Upload new or existing plugin**,
   choose the verified developer identity, upload the ZIP.
3. **MCPs → Connect**: enter the client secret, then verify the domain. The
   portal shows a token: set it as the api's `OPENAI_APPS_CHALLENGE` and
   check `https://api.knorky.com/.well-known/openai-apps-challenge`. Sign in
   with the review account, wait for the tool scan, fix any findings.
4. **Review details**: the reviewer account's email and password, the login
   address (`https://app.knorky.com`), and the video walkthrough URL.
5. **Submit for review**, and after approval **Publish plugin**.

The review account needs a plan that includes the API, a password sign-in
without email codes, and the sample data the test cases in `plugin.json`
name: clients Acme GmbH and Nordwind; project Website Redesign (Acme GmbH)
with the timed task "Logo review"; and time entries on both clients
between 2026-11-16 and 2026-11-22. The cases hold whether or not a timer
runs when the reviewer starts.

## Updating

A change to the tools needs no new package: OpenAI rescans the server daily.
A change to this folder (listing, skill, icons) is a new version: raise
`version` in `plugin.json`, build the ZIP again and upload it for review.
