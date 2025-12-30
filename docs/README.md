# Documentation

This folder contains the detailed REST API documentation and implementation notes for MMM-Webuntis.

## Start Here (Canonical Docs)

- Quickest end-to-end reference: [01-getting-started/IMPLEMENTATION_REFERENCE.md](01-getting-started/IMPLEMENTATION_REFERENCE.md)
- Navigation map (what lives where): [01-getting-started/DOCUMENTATION_INDEX.md](01-getting-started/DOCUMENTATION_INDEX.md)
- Authentication (cookies + bearer token): [02-api-reference/BEARER_TOKEN_GUIDE.md](02-api-reference/BEARER_TOKEN_GUIDE.md)
- Endpoint overview: [02-api-reference/REST_ENDPOINTS_OVERVIEW.md](02-api-reference/REST_ENDPOINTS_OVERVIEW.md)
- App data structure and parsing notes: [02-api-reference/APP_DATA_ANALYSIS.md](02-api-reference/APP_DATA_ANALYSIS.md)
- Implementation patterns and architecture: [03-implementation/REST_IMPLEMENTATION_GUIDE.md](03-implementation/REST_IMPLEMENTATION_GUIDE.md)
- JSON-RPC → REST migration plan: [03-implementation/REST_MIGRATION_PLAN.md](03-implementation/REST_MIGRATION_PLAN.md)
- Parent account specifics: [03-implementation/REST_PARENT_ACCOUNT_SOLUTION.md](03-implementation/REST_PARENT_ACCOUNT_SOLUTION.md)

## Deep Dives

For exhaustive research notes and discovery logs, start at: [04-research/README.md](04-research/README.md)

## Useful Commands

```bash
# Test configuration and fetch data
npm run debug

# Lint
node --run lint

# Spell check
node --run test:spelling
```

## CLI

CLI tooling lives outside this folder: [../cli/README.md](../cli/README.md)
