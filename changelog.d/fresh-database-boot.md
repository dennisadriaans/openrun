A brand-new install no longer dies on first boot. The migration that adds the
webhook-source columns ran before the queue table it adds them to existed, so a
machine with no `data/openrun.db` yet failed with `no such table: run_queue`.
