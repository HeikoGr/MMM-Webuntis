# Implementation

This folder contains implementation-oriented docs (patterns, migration notes, and parent-account specifics).

## Canonical Docs

- Architecture & patterns: [REST_IMPLEMENTATION_GUIDE.md](REST_IMPLEMENTATION_GUIDE.md)
- Migration plan (JSON-RPC → REST): [REST_MIGRATION_PLAN.md](REST_MIGRATION_PLAN.md)
- Parent account specifics: [REST_PARENT_ACCOUNT_SOLUTION.md](REST_PARENT_ACCOUNT_SOLUTION.md)

## Recommended Reading Order

1. End-to-end reference: [../01-getting-started/IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)
2. Authentication deep dive: [../02-api-reference/BEARER_TOKEN_GUIDE.md](../02-api-reference/BEARER_TOKEN_GUIDE.md)
3. Implementation patterns: [REST_IMPLEMENTATION_GUIDE.md](REST_IMPLEMENTATION_GUIDE.md)

## Useful Commands

```bash
node cli/test-webuntis-rest-api.js
node --run lint
```
