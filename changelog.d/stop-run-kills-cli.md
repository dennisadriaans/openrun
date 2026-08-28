- Stopping a run from the composer no longer leaves the agent CLI running.
  Cancel used to drop the process handle before SIGKILL, so a CLI that ignored
  SIGTERM kept working and the transcript kept updating.
