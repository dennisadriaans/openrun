- You no longer open the model picker on models your account cannot run. Claude
  Code ships its whole model registry in the binary, so families you have no
  access to were listed alongside the ones you use. Every picker now opens on
  the three models starting from the one the CLI itself defaults to, and a new
  chat preselects that model instead of one above it. The rest — older
  generations included — are one click away behind the menu's "hidden" toggle,
  and models you had already hidden or unhidden yourself are untouched.
