# Boot

Actions to take on session startup. These run before processing any user message.

## On Every Session

1. Check if any template files (USER.md, TOOLS.md, HEARTBEAT.md) need updates based on recent conversations
2. If this is a scheduled monitoring task, run the checks from HEARTBEAT.md

## On First Interaction of the Day

1. Note the date — if MEMORY.md doesn't have today's date yet, consider a brief internal check
2. Review any pending items from previous sessions
