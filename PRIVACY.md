# Privacy Policy

Context Band is a Claude Code plugin that shows context-window usage above the prompt. This policy covers what it does with data.

## What it collects

Nothing. Context Band does not collect, transmit, sell or share any data.

## What it reads

While a session runs, it reads the context-window figures Claude Code already holds for that session, through Claude Code's plugin API: the `/context` categories and their token counts, the session cost, and the plan rate-limit percentages. It does not read your prompts, Claude's replies, your files or your environment.

## What it keeps

It keeps a few numbers in the session's memory so it can draw the band: the latest figures, the last eight per-turn growth figures, the turn count, the last compaction's before and after sizes, and whether you hid the band. They are discarded when the session ends. Nothing is written to disk.

The only thing it ever writes is your own choice of which items to show, when you run `/context-band <item> on|off`. That is saved as this plugin's option in your Claude Code settings, the same place `/config` saves it.

## What it sends

Nothing. It makes no network requests, runs no programs, and makes no API calls.

## Contact

Questions about this policy: open an issue at https://github.com/ajwann/context-band/issues.
