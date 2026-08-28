You no longer have to open the browser after restarting Open Run before
automations wake up. The scheduler starts with the server, validates expressions
against the cron engine before saving, and records scheduled fires that start,
queue, fail, or are missed.

One-off schedules no longer roll forward to tomorrow when the machine misses
their time. They keep an absolute timestamp, catch up within 15 minutes, then
pause with a visible missed-fire reason. Editing an automation also preserves
its one-off and native-session settings.
