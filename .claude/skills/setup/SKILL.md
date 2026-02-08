---
name: setup
description: Run initial Guardian Core setup. Use when user wants to install dependencies, authenticate WhatsApp, register their main channel, or start the background services. Triggers on "setup", "install", "configure guardian core", or first-time setup requests.
---

# Guardian Core Setup

Run all commands automatically. Only pause when user action is required (scanning QR codes).

**UX Note:** When asking the user questions, prefer using the `AskUserQuestion` tool instead of just outputting text. This integrates with Claude's built-in question/answer system for a better experience.

## 1. Install Dependencies

```bash
cd platform && mix deps.get
```

## 2. Install Container Runtime

First, detect the platform and verify Docker is available:

```bash
echo "Platform: $(uname -s)"
which docker && docker info >/dev/null 2>&1 && echo "Docker: installed and running" || echo "Docker: not installed or not running"
```

If Docker is not available, install/start it before continuing:

- Linux: Install Docker Engine, then start with `sudo systemctl start docker`.

Then verify:

```bash
docker --version
docker info
```

Continue to Section 3 once Docker is confirmed running.

## 3. Configure Claude Authentication

Tell the user:
> Open another terminal window and run:
> ```
> claude setup-token
> ```
> A browser window will open for you to log in. Once authenticated, the token will be displayed in your terminal. Either:
> 1. Paste it here and I'll add it to `.env` for you, or
> 2. Add it to `.env` yourself as `CLAUDE_CODE_OAUTH_TOKEN=<your-token>`

If they give you the token, add it to `.env`:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > .env
```

## 4. Build Container Image

Build the Guardian Core agent container:

```bash
./container/build.sh
```

This creates the `guardian-core-agent:latest` image with Node.js, Chromium, Claude Code CLI, and agent-browser.

Verify the build succeeded by running a simple test:

```bash
echo '{}' | docker run -i --entrypoint /bin/echo guardian-core-agent:latest "Container OK" || echo "Container build failed"
```

## 5. WhatsApp Authentication

**USER ACTION REQUIRED**

Run the authentication script:

```bash
bun run auth
```

Tell the user:
> A QR code will appear. On your phone:
> 1. Open WhatsApp
> 2. Tap **Settings → Linked Devices → Link a Device**
> 3. Scan the QR code

Wait for the script to output "Successfully authenticated" then continue.

If it says "Already authenticated", skip to the next step.

## 6. Configure Assistant Name

Ask the user:
> What trigger word do you want to use? (default: `Andy`)
>
> Messages starting with `@TriggerWord` will be sent to Claude.

If they choose something other than `Andy`, update it in these places:
1. `groups/CLAUDE.md` - Change "# Andy" and "You are Andy" to the new name
2. `groups/main/CLAUDE.md` - Same changes at the top
3. `data/registered_groups.json` - Use `@NewName` as the trigger when registering groups

Store their choice - you'll use it when creating the registered_groups.json and when telling them how to test.

## 7. Understand the Security Model

Before registering your main channel, you need to understand an important security concept.

**Use the AskUserQuestion tool** to present this:

> **Important: Your "main" channel is your admin control portal.**
>
> The main channel has elevated privileges:
> - Can see messages from ALL other registered groups
> - Can manage and delete tasks across all groups
> - Can write to global memory that all groups can read
> - Has read-write access to the entire Guardian Core project
>
> **Recommendation:** Use your personal "Message Yourself" chat or a solo WhatsApp group as your main channel. This ensures only you have admin control.
>
> **Question:** Which setup will you use for your main channel?
>
> Options:
> 1. Personal chat (Message Yourself) - Recommended
> 2. Solo WhatsApp group (just me)
> 3. Group with other people (I understand the security implications)

If they choose option 3, ask a follow-up:

> You've chosen a group with other people. This means everyone in that group will have admin privileges over Guardian Core.
>
> Are you sure you want to proceed? The other members will be able to:
> - Read messages from your other registered chats
> - Schedule and manage tasks
> - Access any directories you've mounted
>
> Options:
> 1. Yes, I understand and want to proceed
> 2. No, let me use a personal chat or solo group instead

## 8. Register Main Channel

Ask the user:
> Do you want to use your **personal chat** (message yourself) or a **WhatsApp group** as your main control channel?

For personal chat:
> Send any message to yourself in WhatsApp (the "Message Yourself" chat). Tell me when done.

For group:
> Send any message in the WhatsApp group you want to use as your main channel. Tell me when done.

After user confirms, start the app briefly to capture the message:

```bash
cd platform && timeout 10 mix phx.server || true
```

Then find the JID from the database:

```bash
# For personal chat (ends with @s.whatsapp.net)
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@s.whatsapp.net' ORDER BY timestamp DESC LIMIT 5"

# For group (ends with @g.us)
sqlite3 store/messages.db "SELECT DISTINCT chat_jid FROM messages WHERE chat_jid LIKE '%@g.us' ORDER BY timestamp DESC LIMIT 5"
```

Create/update `data/registered_groups.json` using the JID from above and the assistant name from step 5:
```json
{
  "JID_HERE": {
    "name": "main",
    "folder": "main",
    "trigger": "@ASSISTANT_NAME",
    "added_at": "CURRENT_ISO_TIMESTAMP"
  }
}
```

Ensure the groups folder exists:
```bash
mkdir -p groups/main/logs
```

## 9. Configure External Directory Access (Mount Allowlist)

Ask the user:
> Do you want the agent to be able to access any directories **outside** the Guardian Core project?
>
> Examples: Git repositories, project folders, documents you want Claude to work on.
>
> **Note:** This is optional. Without configuration, agents can only access their own group folders.

If **no**, create an empty allowlist to make this explicit:

```bash
mkdir -p ~/.config/guardian-core
cat > ~/.config/guardian-core/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
echo "Mount allowlist created - no external directories allowed"
```

Skip to the next step.

If **yes**, ask follow-up questions:

### 9a. Collect Directory Paths

Ask the user:
> Which directories do you want to allow access to?
>
> You can specify:
> - A parent folder like `~/projects` (allows access to anything inside)
> - Specific paths like `~/repos/my-app`
>
> List them one per line, or give me a comma-separated list.

For each directory they provide, ask:
> Should `[directory]` be **read-write** (agents can modify files) or **read-only**?
>
> Read-write is needed for: code changes, creating files, git commits
> Read-only is safer for: reference docs, config examples, templates

### 9b. Configure Non-Main Group Access

Ask the user:
> Should **non-main groups** (other WhatsApp chats you add later) be restricted to **read-only** access even if read-write is allowed for the directory?
>
> Recommended: **Yes** - this prevents other groups from modifying files even if you grant them access to a directory.

### 9c. Create the Allowlist

Create the allowlist file based on their answers:

```bash
mkdir -p ~/.config/guardian-core
```

Then write the JSON file. Example for a user who wants `~/projects` (read-write) and `~/docs` (read-only) with non-main read-only:

```bash
cat > ~/.config/guardian-core/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/docs",
      "allowReadWrite": false,
      "description": "Reference documents"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

Verify the file:

```bash
cat ~/.config/guardian-core/mount-allowlist.json
```

Tell the user:
> Mount allowlist configured. The following directories are now accessible:
> - `~/projects` (read-write)
> - `~/docs` (read-only)
>
> **Security notes:**
> - Sensitive paths (`.ssh`, `.gnupg`, `.aws`, credentials) are always blocked
> - This config file is stored outside the project, so agents cannot modify it
> - Changes require restarting the Guardian Core service
>
> To grant a group access to a directory, add it to their config in `data/registered_groups.json`:
> ```json
> "containerConfig": {
>   "additionalMounts": [
>     { "hostPath": "~/projects/my-app", "containerPath": "my-app", "readonly": false }
>   ]
> }
> ```

## 10. Deploy the Service

Use the brain deploy Mix task which handles building the Elixir release, installing the systemd service template, and starting the service:

```bash
cd platform && mix deploy.brain --all
```

This will:
1. Compile the Elixir app
2. Run tests
3. Build the release
4. Rebuild the container image
5. Install the systemd service
6. Start and verify the service

Verify it's running:
```bash
systemctl --user status guardian-core
```

## 11. Test

Tell the user (using the assistant name they configured):
> Send `@ASSISTANT_NAME hello` in your registered chat.

Check the logs:
```bash
tail -f logs/guardian-core.log
```

The user should receive a response in WhatsApp.

## Troubleshooting

**Service not starting**: Check `logs/guardian-core.error.log`

**Container agent fails with "Claude Code process exited with code 1"**:
- Ensure the container runtime is running:
  - Docker: `docker info` (run `sudo systemctl start docker` if not running)
- Check container logs: `cat groups/main/logs/container-*.log | tail -50`

**No response to messages**:
- Verify the trigger pattern matches (e.g., `@AssistantName` at start of message)
- Check that the chat JID is in `data/registered_groups.json`
- Check `logs/guardian-core.log` for errors

**WhatsApp disconnected**:
- Run `bun run auth` to re-authenticate
- Restart the service: `systemctl --user restart guardian-core`

**Stop service**:
```bash
systemctl --user stop guardian-core
```
