# Contributing Guide

### Commands
- Run specific tests: `pnpm jest path/to/test.ts`
- Run all tests with coverage: `pnpm test`
- Run linting: `pnpm lint`

### Common Packages
- `@extend/logger`: Logging utility (peer dependency)
- `jest`, `ts-jest`: Testing framework
- `dotenv`: Environment variable management
- `oxlint`: Fast linter for TypeScript/JavaScript

### Project Structure
```
src/
├── index.ts         # Main entry point
├── *.ts             # Core functionality files
├── *.test.ts        # Test files adjacent to implementation
└── test/            # Test utilities and setup
```

### Naming Conventions
- Files: kebab-case.ts (e.g., health-check.ts)
- Tests: Same name as implementation file with .test.ts suffix
- Functions/Classes: camelCase for functions, PascalCase for classes

