- Scheduled runs no longer die at their timeout because the Mac went back to
  sleep. Open Run holds a wake assertion for as long as an agent is running, so
  a 30-minute budget buys 30 minutes of work instead of a handful of dark-wake
  seconds.
