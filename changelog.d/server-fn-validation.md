- Open Run's server functions no longer trust whatever JSON arrives. Their
  validators were type annotations, which vanish at build time, so a handler
  that resolves a working directory or writes a workspace file could be handed
  a value of any shape. Every one now checks its payload's types at runtime and
  rejects prototype-polluting fields.
