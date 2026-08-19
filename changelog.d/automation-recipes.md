- You no longer start from a blank prompt. Finishing a connection now offers
  named starting points — implement flagged tickets, start work when something
  moves to In Progress, triage new tickets, do what a comment asks — and each
  one fills the trigger, the prompt, and the name. They are templates, not black
  boxes: everything stays editable, and the form says so once you change it.
- The default is opt-in per ticket. Add the `agent` label to a ticket and the
  agent picks it up; nothing else fires. A connection made in thirty seconds
  can no longer start a run for every issue a busy project files.
- A ticket that arrives already labelled is no longer ignored. Labelling as you
  file is the ordinary way to use a label, and it produces a create rather than
  an update — so the label trigger now covers both, on every provider.
- Recipes a provider cannot honour are not offered. Bitbucket sends no labels,
  so it has no label recipe; Linear and Azure DevOps do not send comment text,
  so they have no comment recipe instead of one that would hand the agent a
  blank instruction.
