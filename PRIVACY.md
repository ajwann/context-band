# Privacy Policy

Next Context is a Claude Code plugin that shows context-window usage above the prompt. This policy covers what it does with data.

## What it collects

Nothing. Next Context does not collect, transmit, sell or share any data.

## What it reads

While a session runs, it reads the context-window figures Claude Code already holds for that session, through Claude Code's plugin API: the `/context` categories and their token counts, the session cost, and the plan rate-limit percentages. It does not read your prompts, Claude's replies, your files or your environment.

## What it keeps

It keeps a few numbers in the session's memory so it can draw the band: the latest figures, the last eight per-turn growth figures, the turn count, the last compaction's before and after sizes, whether you hid the band, and any items you switched with `/next-context <item> on|off`. They are discarded when the session ends.

It writes nothing: not to disk, and not to your Claude Code settings. The options you set in `/config` are saved by Claude Code itself, not by the plugin.

## What it sends

Nothing. It makes no network requests, runs no programs, and makes no API calls.

## Contact

Questions about this policy: open an issue at https://github.com/ajwann/context-band/issues.
