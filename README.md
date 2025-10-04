# Timed Posts Plugin for Obsidian

A focused writing plugin that creates time-limited posts. Write within your deadline or the post gets archived/deleted - no extensions, no excuses!

## Features

- ⏱️ **Time-Limited Writing**: Set a timer when creating a new post (default: 60 minutes)
- 📊 **Status Bar Countdown**: Live countdown timer in the status bar
- ⚠️ **Warning System**: Get notified when time is running low (default: 5 minutes)
- 🎯 **Grace Period**: 10-second final warning with option to complete or let it fail
- 📁 **Smart Archiving**: Failed posts are archived by default (not permanently deleted)
- 🎨 **Template Support**: Use custom templates for your timed posts
- 🔔 **Frontmatter Tracking**: All timer metadata stored in note frontmatter

## How It Works

1. **Start a Timed Post**
   - Click the clock icon in the ribbon, or
   - Use Command Palette: "Start Timed Post"
   - Enter your desired duration in minutes
   - A new note is created and the timer starts

2. **Write Your Post**
   - The status bar shows your remaining time
   - You'll get a warning when time is running low
   - Focus on completing your writing within the deadline

3. **Complete or Fail**
   - **To complete**: Use Command Palette → "Complete Timed Post"
   - **If time expires**: A grace modal appears with two options:
     - "Complete now" - Save the post
     - "Let it fail" - Archive/delete the post
   - After the grace period (10 seconds), the post is automatically archived

## Commands

- **Start Timed Post**: Begin a new timed writing session
- **Complete Timed Post**: Mark the current post as complete
- **Cancel Timed Post**: Immediately archive/delete the current post

## Settings

### Timer Settings
- **Default duration**: How long each timed post lasts (default: 60 minutes)
- **Warning threshold**: When to show the low-time warning (default: 5 minutes)
- **Grace period**: Final warning time before archiving (default: 10 seconds)

### File Management
- **Deletion mode**: Choose what happens to failed posts:
  - Archive to folder (recommended) - Moves to "Failed Timed Posts" folder
  - Obsidian trash - Uses Obsidian's trash
  - System trash - Uses your OS trash
  - Permanent delete - Deletes immediately (use with caution!)
- **Archive folder**: Where failed posts are moved (default: "Failed Timed Posts")
- **Timed posts folder**: Where new timed posts are created (empty = vault root)
- **Template file path**: Optional template to use for new posts

### UI Settings
- **Show status bar**: Toggle the countdown timer in the status bar

## Frontmatter

Timed posts include metadata in their frontmatter:

```yaml
---
timed-post: true
timed-created-at: 2025-01-04T14:30:00.000Z
timer-expires: 2025-01-04T15:30:00.000Z
---
```

When completed:
```yaml
---
timed-post: false
completed-at: 2025-01-04T15:15:00.000Z
---
```

When failed:
```yaml
---
timed-post: false
failed-at: 2025-01-04T15:30:00.000Z
failed-reason: expired
---
```

## Use Cases

- **Focused Writing Sessions**: Force yourself to write without overthinking
- **Timed Journaling**: Quick daily reflections with a time limit
- **Brainstorming**: Rapid idea generation under time pressure
- **Writing Sprints**: Pomodoro-style writing sessions
- **Draft Creation**: First drafts without perfectionism

## Design Philosophy

This plugin is intentionally strict:
- **No extensions**: You get your time and that's it
- **Single active timer**: Focus on one post at a time
- **Archive by default**: Failed posts aren't lost, just moved
- **Restart-resilient**: Timer survives app restarts and sleep

The goal is to create productive pressure that helps you write without overthinking.

## Installation

### From Obsidian Community Plugins (Coming Soon)
1. Open Settings → Community Plugins
2. Search for "Timed Posts"
3. Click Install, then Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder: `{VaultFolder}/.obsidian/plugins/timed-posts/`
3. Copy the files into that folder
4. Reload Obsidian
5. Enable the plugin in Settings → Community Plugins

## Development

```bash
# Install dependencies
npm install

# Build for development (watch mode)
npm run dev

# Build for production
npm run build
```

## Support

If you encounter issues or have suggestions, please open an issue on GitHub.

## License

MIT License - See LICENSE file for details.

## Credits

Inspired by the concept of time-boxed writing and the Pomodoro Technique.
