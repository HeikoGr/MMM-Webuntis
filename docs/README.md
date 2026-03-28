# MMM-Webuntis Documentation

This directory is organized by source of truth. Each topic should have one canonical file; other docs should link there instead of restating the same material.

## Documentation Ownership

| Topic | Canonical file | What belongs there |
| --- | --- | --- |
| User setup and orientation | [../README.md](../README.md) | Install, update, quick start, doc map |
| Configuration keys and auth shapes | [CONFIG.md](CONFIG.md) | Every supported config key, auth pattern, examples |
| External WebUntis API behavior | [API_REFERENCE.md](API_REFERENCE.md) | Endpoints, auth headers, normalization inputs |
| Runtime fetch and retry behavior | [SERVER_REQUEST_FLOW.md](SERVER_REQUEST_FLOW.md) | Timetable-first flow, retries, timeouts, skip rules |
| Frontend/backend payload contract | [API_V2_MANIFEST.md](API_V2_MANIFEST.md) | Canonical runtime payload fields and stability rules |
| High-level structure | [ARCHITECTURE.md](ARCHITECTURE.md) | Module boundaries, responsibilities, extension points |
| Styling and theming | [CSS_CUSTOMIZATION.md](CSS_CUSTOMIZATION.md) | CSS variables, classes, accessibility, legacy theme |
| Grid-specific renderer internals | [GRID_RENDERING_LOGIC.md](GRID_RENDERING_LOGIC.md) | Grid rendering decisions and special cases |
| CLI usage | [../cli/README.md](../cli/README.md) | Commands, options, outputs, troubleshooting |
| API research and ad-hoc endpoint tests | [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) | Experimental endpoint checks and testing scripts |

## Core Docs

- [CONFIG.md](CONFIG.md)
- [API_V2_MANIFEST.md](API_V2_MANIFEST.md)
- [API_REFERENCE.md](API_REFERENCE.md)
- [SERVER_REQUEST_FLOW.md](SERVER_REQUEST_FLOW.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CSS_CUSTOMIZATION.md](CSS_CUSTOMIZATION.md)
- [GRID_RENDERING_LOGIC.md](GRID_RENDERING_LOGIC.md)
- [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md)
- [../cli/README.md](../cli/README.md)

## Quick Reference

```bash
# Validate config and fetch data through the CLI wrapper
node --run debug

# Run the non-interactive configuration check
node --run check

# Test arbitrary WebUntis endpoints
node scripts/test_api_endpoint.js "<endpoint-url>" [--debug] [--raw] [--student=N]

# Probe endpoint patterns with the discovery script
node --run test:api:discover

# Lint and formatting checks
node --run lint

# Spell check
node --run test:spelling
```

Endpoint discovery is documented through the testing workflow and `scripts/discover_endpoints.sh`; there is no separate endpoint-discovery document anymore.