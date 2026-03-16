# MMM-Webuntis Documentation

This directory contains comprehensive documentation for the MMM-Webuntis module.

## Documentation Structure

### Core Documentation
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture, data flow diagrams, and module structure
- **[API_REFERENCE.md](API_REFERENCE.md)** - REST and JSON-RPC endpoints, authentication, data normalization
- **[API_V2_MANIFEST.md](API_V2_MANIFEST.md)** - Canonical socket payload contract (`GOT_DATA` v2)
- **[API_TESTING_GUIDE.md](API_TESTING_GUIDE.md)** - API testing tool, calendar-entry research, and endpoint comparison
- **[API_ENDPOINT_DISCOVERY.md](API_ENDPOINT_DISCOVERY.md)** - Methods to discover available WebUntis API endpoints
- **[CONFIG.md](CONFIG.md)** - Complete configuration reference
- **[CSS_CUSTOMIZATION.md](CSS_CUSTOMIZATION.md)** - Styling guide, CSS variables, and accessibility options
- **[LEGACY_COLOR_SCHEME.md](LEGACY_COLOR_SCHEME.md)** - Recreate the previous multi-color look via CSS overrides

---

## Quick Reference

### Testing & Debugging

```bash
# Test configuration and fetch data
node --run debug

# Test arbitrary WebUntis API endpoints
node scripts/test_api_endpoint.js "<endpoint-url>" [--debug] [--raw] [--student=N]

# Discover available API endpoints
node --run test:api:discover

# Lint code
node --run lint

# Spell check
node --run test:spelling

# Check configuration
node --run check
```

**See**: [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) for detailed endpoint testing examples.
**See**: [API_ENDPOINT_DISCOVERY.md](API_ENDPOINT_DISCOVERY.md) for endpoint discovery methods.

### CLI

CLI tooling documentation: [../cli/README.md](../cli/README.md)

