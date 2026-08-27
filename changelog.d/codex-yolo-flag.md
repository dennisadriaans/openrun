Codex full-access runs no longer die on `error: unexpected argument '--full-auto'
found`. Recent `codex exec` dropped that flag, so Open Run passes `--yolo`
instead — and clears a stale `--full-auto` out of saved runtime args.
