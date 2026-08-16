# GLOSSARY fixture — a malformed entry

The parse contract makes every field mandatory and requires the lint to FAIL on a
malformed entry rather than skip it: a silently skipped entry is a rule that stopped
being enforced without anyone noticing, which is the failure mode this charter exists
to break. This fixture's single entry omits `pattern:`, so the self-test can assert
the loud failure (exit 2, naming the entry and the missing field).

## Entries

### term: widget
definition: The fixture's canonical noun, here declared without the pattern the lint needs.
avoid: wodget, wodgets
except: none
applies-to: skill-body
check: avoid-term
evidence: this file exists solely to be malformed
