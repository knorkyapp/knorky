# Knorky

A local-first time tracker for freelancers. Your data lives in a file on
your computer; an account and sync between devices are optional.

**[Download for Windows](https://github.com/knorkyapp/knorky/releases/latest)** ·
**[Web app](https://app.knorky.com)** ·
**[Website: knorky.com](https://knorky.com)** ·
**[Docs](https://knorky.com/en/docs/)**

The website is in German: [all features](https://knorky.com/funktionen/),
[plans and prices](https://knorky.com/preise/),
[guides](https://knorky.com/ratgeber/), [FAQ](https://knorky.com/faq/) and
the [blog](https://knorky.com/blog/). The docs and support are in English
too.

## See it in action

The videos show the German interface.

### Create a task, start the timer

<kbd>Ctrl</kbd>+<kbd>N</kbd>, type a title, Enter, and one click starts the
timer.

https://github.com/user-attachments/assets/852c126d-a525-4335-b2c0-a609b7bcd7e9

### Two tasks at once

Start a second task alongside the first: the time is split evenly between
both.

https://github.com/user-attachments/assets/e57ad17a-caf7-4e5c-91f6-347ccf2a720b

## What it does

- **Timers** — start, pause and switch tasks in one click. Run several
  timers side by side, stop them all with one shortcut. Running time is
  saved every few seconds, so a crash loses nothing.
- **Idle detection** — after a while without input, Knorky asks what that
  time was when you come back: work, no work, or a break.
- **Clients, projects, tasks** — with colours, icons and hourly rates that
  apply from workspace down to a single task. Currencies stay apart.
- **Monthly goals** — set hours per month per client; Knorky works out what
  each week and day needs and shows a catch-up plan when you fall behind.
- **Reports** — month report per client, a flexible report you can group,
  filter and bookmark, and CSV export.
- **Invoices** — create a draft invoice in Lexware Office from a month's
  time.
- **Linear and GitHub** — type `#ENG-123` or `#42` in a task title to link
  the issue and see its status on the task.
- **AI assistant and REST API** — connect Claude to start timers, create
  tasks and ask about your time ([how to connect](https://knorky.com/en/docs/mcp/)),
  or script it over HTTP ([REST API](https://knorky.com/en/docs/api/)).
- **Keyboard first** — every command has a shortcut you can change;
  start/pause works system-wide.
- **Backups and import** — scheduled backups to a folder you choose, import
  from Super Productivity, CSV export that Toggl Track and Clockify read.
- **Looks** — light and dark, ten themes, your own accent colour. English
  and German.

## Download

The desktop app is available for **Windows**. Get the installer
(`Knorky_<version>_x64-setup.exe`) from the
[latest release](https://github.com/knorkyapp/knorky/releases/latest).
The app updates itself after that; a running timer is never interrupted.

Installation help and every release's notes are on the website:
[download](https://knorky.com/download/) and
[what's new](https://knorky.com/updates/) (both in German).

There is no macOS, Linux or phone app yet. On a phone, the
[web app](https://app.knorky.com) has a layout of its own.

## Claude Code plugin

With the plugin, Claude Code tracks your work by itself: it starts the
timer for the task it works on, shows it above the prompt, and stops it
when you stop. Type this at the prompt of Claude Code:

```
/plugin install knorky-mod --marketplace knorkyapp/knorky
```

It needs a Knorky account with the Plus plan. How to sign in, the
commands, and what to do when something is wrong:
[the documentation](https://knorky.com/en/docs/claude-code-plugin/).

A lighter version, `knorky`, is in [claude-plugin/](claude-plugin/) and
submitted to Claude's plugin directory: the same sign-in, tracking rules and
commands, as plain text with no code on your computer. It has no timer line
above the prompt, and it cannot stop the timers when a session ends. Install
one of the two, not both.

## ChatGPT and Codex

[openai-plugin/](openai-plugin/) is the package for OpenAI's plugin
directory, which serves ChatGPT and Codex: the same hosted server and
sign-in, and a skill with the rules for using its tools.

## Your data

Without an account, the desktop app works fully offline and contacts no
server. Signing in adds sync across your devices. Usage statistics and error
reports are off until you switch them on. Details:
[privacy policy](https://knorky.com/privacy/).

## Feedback and bugs

Found a bug or missing something? [Open an issue](https://github.com/knorkyapp/knorky/issues/new)
in this repository. You can also send feedback from inside the app.

## Source code

Knorky is open source under the
[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html). The Claude Code
plugin's source is in [knorky-mod/](knorky-mod/), the directory's
lighter version in [claude-plugin/](claude-plugin/). The app's source
code is not public yet, but it is **available on request**: open an issue
here and ask, and you will be invited to the source repository.
