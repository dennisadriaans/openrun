The run page no longer leaves you guessing whether a run's work actually
shipped: a pull request on the run's branch now shows above the composer with
its state and check status, whether you opened it from the workspace panel or
the agent opened it itself with `gh pr create`. An automation run no longer
echoes back the settings you saved instead of the ones the CLI actually
received — the transcript opens with a stub read off the argv, so a model or
effort that silently failed to reach the binary is visible rather than assumed.
A one-shot automation scheduled for 03:01 is no longer labelled "Daily at
03:01"; it says when it fires, once.
