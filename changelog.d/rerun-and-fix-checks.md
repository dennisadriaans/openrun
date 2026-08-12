The Checks panel no longer counts one failure twice. A verification pass is now identified by
the turn it verified as well as the repair attempt, so two ordinary turns of the same run stop
folding into a single pass and reporting the same red check once per turn.

A stale pass no longer looks like the truth. When the newest results verified an earlier turn,
the panel says so and offers **Re-run checks**, which runs the project's checks against the
workspace as it stands now instead of leaving yesterday's verdict on screen.

You no longer have to describe a failing check to the agent and hope it guesses the right
command. **Fix checks** sends the recorded failure — command, exit code and captured output —
as the next message, so the agent works from what actually failed rather than from a build it
chose to run itself.
