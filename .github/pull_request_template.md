## Documentation Review

Use this checklist before requesting review and before approving.

### Type of Change

- [ ] New API endpoint documentation
- [ ] Updated endpoint documentation
- [ ] Deprecation or migration documentation
- [ ] Governance or process documentation
- [ ] Template or prompt update

### Documentation Accuracy

- [ ] Content matches the current system behavior
- [ ] All examples are aligned with real requests and responses
- [ ] Endpoint path and method match the OpenAPI or source definition
- [ ] Request parameters exist in the source schema
- [ ] Response fields exist in the source schema
- [ ] Authentication model is correct

### Completeness

- [ ] Prerequisites are documented
- [ ] Parameters, constraints, and outputs are fully covered
- [ ] Frontmatter is complete (`service`, `owner`, `api_version`, `status`, `last_reviewed`)
- [ ] `reviewed_by` is set to the approving team member before merge

### Security

- [ ] Authentication and authorization requirements are explicit
- [ ] No secrets, internal hostnames, or unsafe examples are present

### Version Compatibility

- [ ] The relevant API version is identified in frontmatter
- [ ] Beta or deprecated states are clearly marked
- [ ] If deprecated, `deprecated_since`, `replaced_by`, and `migration_guide` are set

### AI-Generated Content (if applicable)

- [ ] Endpoint paths and methods verified against source spec
- [ ] No invented fields present in request or response examples
- [ ] All `Needs SME input` labels resolved before publication
- [ ] Hallucination guardrail checklist reviewed (`validation/hallucination-guards/api-doc-guardrails.md`)

### Validation

- [ ] `npm run validate` passes locally
- [ ] `npm run coverage:check` shows no newly undocumented endpoints
