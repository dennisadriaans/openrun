You no longer have to start a run to find out what a runtime actually spawns —
the Runtimes editor shows a live **Command preview** of the resolved argv
(with the flags Open Run injects highlighted, and any template flag it took
over called out), say how the prompt reaches the CLI, and let you copy the
exact command. A template that would leave the agent with no prompt at all is
now flagged before you save it instead of producing a silent no-op run.
