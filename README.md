# Eliza Plugin Auto-Upgrader

An automated CLI tool that migrates Eliza plugins from version 0.x to 1.x using Claude Code.

## Features

- 🚀 Automatically analyzes plugin repositories
- 🤖 Generates specific migration strategies using Claude AI API
- 🔄 Creates a new branch with all necessary changes
- ✅ Ensures comprehensive test coverage
- 📦 Updates package.json with modern scripts
- 🎯 Handles both GitHub URLs and local folders
- 📚 Supports example-based migrations from textfiles directory
- 🤖 Runs Claude Code in CLI mode for fully automated migration

## Prerequisites

- Node.js 18+ 
- npm or yarn
- [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed globally
- An Anthropic account for Claude Code authentication
- **Required**: Anthropic API key for strategy generation

## Installation

```bash
# Install the tool globally
npm install -g eliza-plugin-auto-upgrader

# Or run directly with npx
npx eliza-plugin-auto-upgrader <github-url-or-folder>
```

## Setup

### 1. Get an Anthropic API Key
Visit [console.anthropic.com](https://console.anthropic.com) to get your API key.

### 2. Set the API Key
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

## Usage

### Basic usage:
```bash
# Upgrade a GitHub repository
eliza-upgrade https://github.com/username/eliza-plugin-example

# Upgrade a local folder
eliza-upgrade ./my-eliza-plugin
```

### With API key via command line:
```bash
eliza-upgrade https://github.com/username/eliza-plugin-example --api-key sk-ant-...
```

## How It Works

1. **Repository Analysis**
   - Clones GitHub repos (prefers `0.x` branch, falls back to `main`)
   - Reads README.md, package.json, and index files
   - Collects all TypeScript/JavaScript files
   - Uses tiktoken to manage context size (max 20,000 tokens)

2. **Example Loading** (if textfiles directory exists)
   - Loads migration examples from `textfiles/<plugin-name>-old` and `textfiles/<plugin-name>-new`
   - Uses these examples to enhance migration accuracy

3. **Specific Strategy Generation**
   - Uses Claude API to analyze the specific plugin codebase
   - Generates detailed, file-specific migration instructions
   - Identifies exact imports, types, and functions to change
   - Creates a complete test plan

4. **Migration Instructions Creation**
   - Combines base migration rules with specific strategy
   - Writes `CLAUDE.md` to the repository
   - Includes all specific changes and test requirements

5. **Automated Migration**
   - Creates a new `1.x-claude` branch
   - Runs Claude Code in CLI mode (`--print --max-turns 30`)
   - Applies all changes systematically
   - Creates comprehensive tests
   - Runs tests to verify migration

6. **Quality Assurance**
   - Adds Vitest for unit testing
   - Creates runtime plugin tests
   - Updates package.json with test scripts including `bun run test`
   - Automatically runs tests after migration

## Migration Process

The tool generates a specific migration strategy for each plugin that includes:

- **Exact File Changes**: Lists each file with specific modifications
- **Import Mappings**: Old import → new import for the codebase
- **Type Updates**: Every type that needs updating with old → new
- **Service Migrations**: How to migrate each service class
- **Memory Operations**: All memory operation updates needed
- **Model Usage**: All model call replacements
- **Test Files**: Specific test files to create with coverage plans
- **Package.json**: Exact scripts and dependencies to add

## Example Output

After running the tool, your plugin will have:

```
my-eliza-plugin/
├── src/
│   ├── index.ts        # Updated with 1.x architecture
│   ├── services/       # Migrated services
│   └── __tests__/      # New unit test files
├── tests/              # Runtime integration tests
├── package.json        # Updated scripts and dependencies
├── vitest.config.ts    # Test configuration
├── CLAUDE.md # Specific migration instructions
└── README.md           # Updated documentation
```

## Package.json Scripts

The tool adds these scripts to your package.json:

```json
{
  "scripts": {
    "test": "vitest",
    "test:plugins": "elizaos test",
    "build": "tsc",
    "format": "prettier --write .",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:bun": "bun test"
  }
}
```

## Adding Migration Examples

To improve migration quality, you can add example migrations:

1. Create directories in `textfiles/`:
   - `textfiles/<plugin-name>-old/` - Contains 0.x version files
   - `textfiles/<plugin-name>-new/` - Contains 1.x version files

2. Add corresponding TypeScript/JavaScript files in each directory

3. The tool will reference these examples when generating strategies

## Troubleshooting

### ANTHROPIC_API_KEY not found
The tool requires an Anthropic API key to generate specific migration strategies:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Claude Code not found
Install Claude Code globally:
```bash
npm install -g @anthropic-ai/claude-code
```

### Authentication issues
Make sure you're authenticated with Claude Code:
```bash
claude login
```

### Branch already exists
The tool will automatically delete and recreate the `1.x-claude` branch if it exists.

### Token limit exceeded
If your repository is too large, the tool will prioritize:
1. README.md
2. package.json
3. index.ts or src/index.ts
4. Other files by depth and alphabetical order

### Migration failures
Check the `CLAUDE.md` file in your repository for the specific strategy and run manually if needed:
```bash
cd your-repo
claude --print --max-turns 30 "Please read the CLAUDE.md file..."
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT 