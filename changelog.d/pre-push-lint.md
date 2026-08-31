Your pre-push hook no longer rewrites files while a push is in progress. It now checks lint only and tells you to run `pnpm lint:fix` yourself when fixes are needed.
