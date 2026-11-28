# Hostile fixtures

Specs written to attack the generator: HTML and script in descriptions, `javascript:` links, text that tries to add frontmatter keys, and an `operationId` with `../`. The tests check that generated docs show all of it as text.
