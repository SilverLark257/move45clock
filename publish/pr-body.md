Adds SilverLark257/move45clock — a health clock plugin for DSH.

- 45-minute work timer (adjustable 5–120 minutes) that runs in the host process, so it keeps counting while the window is minimized or in the tray.
- 12 built-in 12–15 minute guided break plans (seated/standing only, no jumping or floor work), with a 10-second ready countdown, per-step reps/seconds, set badges and total remaining time.
- Visual plan editor in Settings: create, copy, edit, disable and delete plans, restore built-in defaults; saved to plans.json and applied from the next round without restarting DSH.
- Reminder card scaling from 100% to 200%.
- Night reminders at 21:30 / 22:00 / 22:30 on a dark starry-night card, de-duplicated per day.
- Optional action-name voice coaching through the system speech engine (action names only, no number reading).
- Window wake is Windows-only (tray click via UI Automation); the rest of the plugin is cross-platform.

The package is published from this repository as `dsh-clock`; the display name is Move45clock.

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
