<!-- personal override — _local/slots/ship.review.md (tier rank 30, merge policy: replace) -->
<!-- Seeded into this run workspace to exercise the orphaned-override precedence property
     (WF-348 / C014-4). It supersedes the pack ship.review fill wholesale under replace. -->

Address every open review thread at HEAD_SHA. Hold the merge while any finding thread on the
pull request is unresolved — this personal gate does not merge on a replied-but-unresolved
thread. (This is an older, stricter gate than the current pack fill: the orphaned-override
watch-list risk is that it silently keeps this behaviour after a pack upgrade.)
