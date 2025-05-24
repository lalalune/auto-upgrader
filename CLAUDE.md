# CLAUDE.md

This file provides instructions for Claude Code to migrate Eliza plugins from 0.x to 1.x format.

IMPORTANT NOTES:

Complete code examples of old and new plugins are available in the /textfiles directory, under <pluginname>-new and <pluginname>-old
We are using prettier and eslint now, not biome. Remove biome and replace with prettier and eslint

## Migration Tool Overview

This is a CLI tool that automates the migration of Eliza plugins from version 0.x to 1.x. The tool:
1. Takes a GitHub repo URL or local folder path as input
2. Clones the repo if needed (preferring `0.x` branch, falling back to `main`)
3. Analyzes the codebase
4. Generates a migration strategy using Claude
5. Creates a new `1.x-claude` branch with all changes
6. Ensures all tests pass before completion

## Build and Test Commands
- Install dependencies: `npm install`
- Build: `npm run build`
- Format code: `npm run format` (runs Prettier)
- Run tests: `npm test` (runs Vitest)
- Run plugin tests: `npm run test:plugins` (Eliza plugin tests)
- Type check: `npm run typecheck`
- Lint: `npm run lint`

## Migration Process

### 1. Repository Analysis
- Clone repository if GitHub URL provided
- Check for `0.x` branch first, fallback to `main`
- Read core files: `README.md`, `package.json`, `index.ts` or `src/index.ts`
- Collect all `.ts` and `.js` files
- Use tiktoken to count tokens
- Create context (max 20,000 tokens) prioritizing: README → index.ts → other files

### 2. Migration Strategy Generation
Generate a comprehensive migration plan that includes:
- All import path changes (e.g., `elizaLogger` → `logger`)
- Type migrations (`Account` → `Entity`, `userId` → `entityId`)
- Service architecture updates (lifecycle methods, registration)
- Event system implementation
- Memory/database operation updates
- Model usage changes (`generateText` → `runtime.useModel`)
- Knowledge system migration to plugin
- Provider updates for dynamic loading
- Action system changes for multi-action support
- Template migration from JSON to XML
- Remove biome and replace with prettier and eslint

### 3. Code Migration
Apply changes systematically:
- Update all imports
- Replace deprecated functions
- Migrate services to extend base `Service` class
- Implement proper event emission
- Add world/entity management
- Update memory operations with metadata
- Convert templates to XML format
- Add OpenTelemetry instrumentation where applicable

### 4. Testing Strategy
Create comprehensive tests:
- Unit tests for all migrated components (Vitest)
- Integration tests for plugin functionality
- Runtime plugin tests using Eliza's test framework
- Mock runtime for isolated testing
- Test service lifecycle (start/stop)
- Verify event emission and handling
- Validate model usage
- Ensure memory operations work with new structure

### 5. Package.json Updates
Ensure package.json includes:
```json
{
  "scripts": {
    "test": "vitest",
    "test:plugins": "elizaos test",
    "build": "tsc",
    "format": "prettier --write .",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "vitest": "latest",
    "@elizaos/core": "^1.0.0",
    "prettier": "latest",
    "typescript": "latest",
    "eslint": "latest"
  }
}
```

## Key Migration Patterns

### Service Migration
```typescript
// 0.x: Simple class
class MyService {
  constructor(runtime) { this.runtime = runtime; }
  async initialize() { /* setup */ }
}

// 1.x: Extends Service with lifecycle
export class MyService extends Service {
  static serviceType = 'my-service';
  static async start(runtime) { /* return instance */ }
  async stop() { /* cleanup */ }
}
```

### Memory Operations
```typescript
// 0.x
memory.userId = userId;
memory.embedding = getEmbeddingZeroVector();
await runtime.messageManager.createMemory(memory);

// 1.x
memory.entityId = entityId;
// No embedding needed - handled by runtime
await runtime.createMemory(memory, 'messages');
```

### Model Usage
```typescript
// 0.x
const response = await generateText({ runtime, context, modelClass: ModelClass.LARGE });

// 1.x
const response = await runtime.useModel(ModelType.TEXT_LARGE, { prompt: context });
```

## Testing Requirements
1. All tests must pass before considering migration complete
2. Maintain or improve existing test coverage
3. Add tests for new 1.x features (worlds, entities, events)
4. Mock external dependencies appropriately
5. Test both happy paths and error cases

## Success Criteria
- [ ] All imports updated to 1.x format
- [ ] Services properly extended and registered
- [ ] Event system implemented for message handling
- [ ] Memory operations use new API with table names
- [ ] Model usage converted to runtime.useModel
- [ ] Templates migrated to XML format
- [ ] All tests passing (unit and integration)
- [ ] No TypeScript errors
- [ ] Code formatted with Prettier
- [ ] Plugin successfully initializes in 1.x runtime

## Interactive Workflow
When running this migration:
1. Analyze the repository structure
2. Generate and display migration strategy
3. Create `1.x-claude` branch
4. Apply migrations file by file
5. Run tests after each major change
6. Fix any failing tests
7. Ensure all tests pass before completion
8. Commit changes with descriptive messages

Remember: The goal is a fully functional 1.x plugin with comprehensive test coverage. Don't just make syntax changes - ensure the plugin works correctly in the new architecture.