Requests ending in a runtime and model, such as `claude sonnet`, no longer
require an explicit effort to resolve locally. A task followed by
`in 10 seconds claude sonnet` keeps its original text and schedules directly.
Rejected interpretation requests now show their HTTP status instead of
claiming the service is unavailable.
