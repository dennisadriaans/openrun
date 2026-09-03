- A message that the server refuses no longer vanishes from the composer. When a
  send fails — the workspace directory is gone, the branch already has a run —
  the text and any attached images come back in the box, so you can fix the
  cause and press send again instead of retyping what you just wrote.
- The branch picker no longer keeps offering a branch whose directory Open Run
  just discovered was deleted. The refusal that demotes the branch now refreshes
  the list too, so the next attempt does not fail the same way.
