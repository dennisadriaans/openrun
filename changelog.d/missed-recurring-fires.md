- A recurring automation that came due while Open Run was not running no longer
  vanishes without a trace. On start-up Open Run counts what it missed: a fire
  from the last fifteen minutes is run, and anything older is recorded as a
  visible missed fire on the automation instead of quietly waiting for tomorrow.
