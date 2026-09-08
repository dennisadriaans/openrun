- A native client no longer has to ship its own grammars to colour code. Open
  Run tokenizes a snippet on request with the same highlighter the web
  transcript uses, answering the `hl-*` class names rather than colours, so the
  desktop app paints the identical syntax without a second set of parsers that
  could drift from ours.
