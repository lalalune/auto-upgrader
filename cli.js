#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { simpleGit } from 'simple-git';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { globby } from 'globby';
import { encoding_for_model } from 'tiktoken';
import { execa } from 'execa';
import Anthropic from '@anthropic-ai/sdk';
import os from 'os';
import { config } from "dotenv";
config()

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize tiktoken encoder
const encoder = encoding_for_model('gpt-4');

// Configuration
const MAX_TOKENS = 20000;
const BRANCH_NAME = '1.x-claude';

class PluginUpgrader {
  constructor() {
    this.git = simpleGit();
    this.repoPath = null;
    this.isGitHub = false;
    this.originalPath = null;
    this.anthropic = null;
  }

  async initializeAnthropic() {
    // Check for API key in environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.log(chalk.yellow('\n⚠️  ANTHROPIC_API_KEY not found in environment.'));
      console.log(chalk.gray('Please set ANTHROPIC_API_KEY to generate specific migration strategies.'));
      throw new Error('ANTHROPIC_API_KEY is required for migration strategy generation');
    }
    
    this.anthropic = new Anthropic({
      apiKey: apiKey
    });
  }

  async run(input) {
    const spinner = ora();
    
    try {
      console.log(chalk.blue('🚀 Eliza Plugin Auto-Upgrader'));
      console.log(chalk.gray('─'.repeat(50)));

      // Initialize Anthropic (required)
      await this.initializeAnthropic();

      // Step 1: Handle input (GitHub URL or local folder)
      spinner.start('Analyzing input...');
      await this.handleInput(input);
      spinner.succeed('Input validated');

      // Check if CLAUDE.md already exists
      const claudeMdPath = path.join(this.repoPath, 'CLAUDE.md');
      let skipGeneration = false;
      
      if (await fs.pathExists(claudeMdPath)) {
        console.log(chalk.yellow('\n⚠️  CLAUDE.md already exists in the repository.'));
        console.log(chalk.gray('Skipping migration strategy generation...'));
        skipGeneration = true;
      }

      let specificStrategy = null;

      if (!skipGeneration) {
        // Step 2: Analyze repository
        spinner.start('Analyzing repository structure...');
        const context = await this.analyzeRepository();
        spinner.succeed('Repository analyzed');

        // Step 3: Generate specific migration strategy
        spinner.start('Generating specific migration strategy for this plugin...');
        specificStrategy = await this.generateMigrationStrategy(context);
        spinner.succeed('Migration strategy generated');

        // Step 4: Create CLAUDE.md with specific instructions
        spinner.start('Creating migration instructions file...');
        await this.createMigrationInstructions(specificStrategy);
        spinner.succeed('Migration instructions created');
      }

      // Step 5: Create new branch
      spinner.start(`Creating branch ${BRANCH_NAME}...`);
      await this.createBranch();
      spinner.succeed(`Branch ${BRANCH_NAME} created`);

      // Step 6: Run Claude Code in CLI mode
      console.log(chalk.yellow('\n🤖 Running Claude Code to apply migrations...'));
      await this.runClaudeCode();

      console.log(chalk.green('\n✅ Migration complete!'));
      console.log(chalk.gray(`Branch ${BRANCH_NAME} has been created with all changes.`));
      
    } catch (error) {
      spinner.fail('Migration failed');
      console.error(chalk.red('\n❌ Error:'), error.message);
      if (error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  }

  async handleInput(input) {
    // Check if input is a GitHub URL
    if (input.includes('github.com')) {
      this.isGitHub = true;
      this.originalPath = input;
      
      // Extract repo name from URL - handle various formats
      const match = input.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
      if (!match) {
        throw new Error('Invalid GitHub URL format');
      }
      
      const repoName = match[2];
      this.repoPath = path.join(process.cwd(), repoName);
      
      // Check if folder already exists
      if (await fs.pathExists(this.repoPath)) {
        console.log(chalk.yellow(`\n📁 Using existing folder: ${this.repoPath}`));
      } else {
        console.log(chalk.yellow(`\n📥 Cloning repository...`));
        await this.git.clone(input, this.repoPath);
      }
      
      // Change to repo directory
      this.git = simpleGit(this.repoPath);
      
      // Check for 0.x branch, fallback to main
      const branches = await this.git.branch();
      if (branches.all.includes('origin/0.x') || branches.all.includes('0.x')) {
        await this.git.checkout('0.x');
        console.log(chalk.gray('Checked out 0.x branch'));
      } else if (branches.all.includes('origin/main') || branches.all.includes('main')) {
        await this.git.checkout('main');
        console.log(chalk.gray('No 0.x branch found, using main'));
      }
    } else {
      // Local folder
      this.repoPath = path.resolve(input);
      if (!await fs.pathExists(this.repoPath)) {
        throw new Error(`Folder not found: ${this.repoPath}`);
      }
      this.git = simpleGit(this.repoPath);
    }
  }

  async analyzeRepository() {
    const files = {
      readme: null,
      packageJson: null,
      index: null,
      sourceFiles: []
    };

    // Read README
    const readmePath = path.join(this.repoPath, 'README.md');
    if (await fs.pathExists(readmePath)) {
      files.readme = await fs.readFile(readmePath, 'utf-8');
    }

    // Read package.json
    const packagePath = path.join(this.repoPath, 'package.json');
    if (await fs.pathExists(packagePath)) {
      files.packageJson = await fs.readFile(packagePath, 'utf-8');
    }

    // Read index file
    const indexPaths = ['index.ts', 'src/index.ts', 'index.js', 'src/index.js'];
    for (const indexPath of indexPaths) {
      const fullPath = path.join(this.repoPath, indexPath);
      if (await fs.pathExists(fullPath)) {
        files.index = {
          path: indexPath,
          content: await fs.readFile(fullPath, 'utf-8')
        };
        break;
      }
    }

    // Find all .ts and .js files
    const sourceFiles = await globby(['**/*.ts', '**/*.js'], {
      cwd: this.repoPath,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '*.test.*', '*.spec.*', 'coverage/**']
    });

    // Read source files and calculate tokens
    let totalTokens = 0;
    const readmeTokens = files.readme ? encoder.encode(files.readme).length : 0;
    const packageTokens = files.packageJson ? encoder.encode(files.packageJson).length : 0;
    const indexTokens = files.index ? encoder.encode(files.index.content).length : 0;
    
    totalTokens = readmeTokens + packageTokens + indexTokens;

    // Sort files by importance (based on path depth and name)
    const sortedFiles = sourceFiles.sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    // Add files until we reach token limit
    for (const file of sortedFiles) {
      if (file === files.index?.path) continue; // Skip index file (already included)
      
      const filePath = path.join(this.repoPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const fileTokens = encoder.encode(content).length;
      
      if (totalTokens + fileTokens > MAX_TOKENS) {
        console.log(chalk.gray(`\nReached token limit. Included ${files.sourceFiles.length} source files.`));
        break;
      }
      
      files.sourceFiles.push({
        path: file,
        content: content
      });
      totalTokens += fileTokens;
    }

    console.log(chalk.gray(`\nTotal tokens: ${totalTokens}/${MAX_TOKENS}`));
    
    // Create context string
    let context = '';
    
    if (files.readme) {
      context += '# README.md\n\n' + files.readme + '\n\n';
    }
    
    if (files.packageJson) {
      context += '# package.json\n\n```json\n' + files.packageJson + '\n```\n\n';
    }
    
    if (files.index) {
      context += `# ${files.index.path}\n\n\`\`\`typescript\n${files.index.content}\n\`\`\`\n\n`;
    }
    
    for (const file of files.sourceFiles) {
      context += `# ${file.path}\n\n\`\`\`typescript\n${file.content}\n\`\`\`\n\n`;
    }
    
    return context;
  }

  async generateMigrationStrategy(context) {
    // Create prompt to generate specific migration strategy
    let prompt = `You are migrating an Eliza plugin from version 0.x to 1.x. Analyze the provided codebase and generate a SPECIFIC, DETAILED migration strategy.

## Key Migration Requirements:

1. **Import Updates**: All @elizaos imports must use new paths (elizaLogger → logger, etc.)
2. **Type Migrations**: Account → Entity, userId → entityId, room → world
3. **Service Architecture**: Services must extend base Service class with lifecycle methods
4. **Event System**: Implement proper event emission and handling
5. **Memory Operations**: Update to use new API with table names
6. **Model Usage**: Convert generateText to runtime.useModel
7. **Templates**: Migrate from JSON to XML format
8. **Testing**: Create comprehensive unit and integration tests

## Repository Context:

${context}`;


    prompt += `

## Task:

Generate a SPECIFIC migration strategy for THIS plugin. Your response should include:

1. **Exact File Changes**: List each file that needs to be modified with specific changes
2. **Import Mappings**: Exact old import → new import for this codebase
3. **Type Updates**: List every type that needs updating with old → new
4. **Service Migrations**: Identify services and exactly how to migrate them
5. **Memory Operation Updates**: Find all memory operations and show exact changes
6. **Model Usage Updates**: Find all model calls and show exact replacements
7. **Test Files to Create**: List specific test files with what they should test
8. **Package.json Updates**: Exact scripts and dependencies to add/update

Be extremely specific. Use actual file names, function names, and line references from the codebase.
Format your response as a clear, actionable migration plan.`;

    try {
      const message = await this.anthropic.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 8192,
        temperature: 0,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });
      
      // Handle potential refusal stop reason (new in Claude 4)
      if (message.stop_reason === 'refusal') {
        throw new Error('Claude refused to generate the migration strategy. Please try again.');
      }
      
      return message.content[0].text;
    } catch (error) {
      if (error.message.includes('model_not_found')) {
        console.error(chalk.yellow('\n⚠️  Claude 4 Opus model not available. Falling back to Claude 3 Sonnet...'));
        // Fallback to Claude 3 Sonnet
        const message = await this.anthropic.messages.create({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 4000,
          temperature: 0,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
        return message.content[0].text;
      }
      throw error;
    }
  }

  async createMigrationInstructions(specificStrategy) {
    // Read base CLAUDE.md
    const baseClaude = await fs.readFile(path.join(__dirname, 'CLAUDE.md'), 'utf-8');
    
    // Create combined instructions
    let combinedInstructions = baseClaude + `

## SPECIFIC MIGRATION STRATEGY FOR THIS PLUGIN

${specificStrategy}

## MIGRATION EXECUTION INSTRUCTIONS

You are now going to apply the above migration strategy to this codebase. Follow these steps:

1. **Apply All File Changes**: Go through each file listed in the strategy and apply the exact changes specified
2. **Create Test Files**: Create all the test files mentioned in the strategy with comprehensive test coverage
3. **Update package.json**: Add all scripts and dependencies as specified
4. **Run Tests**: After making changes, run the tests to ensure everything works
5. **Fix Any Issues**: If tests fail, debug and fix the issues
6. **Format Code**: Run prettier to format all code

Work systematically through the strategy. Make all changes, create all tests, and ensure everything is working before finishing.

The goal is a fully migrated, tested, and working 1.x plugin.
`;

    // Write to repo
    const outputPath = path.join(this.repoPath, 'CLAUDE.md');
    await fs.writeFile(outputPath, combinedInstructions);
    console.log(chalk.gray(`\nMigration instructions written to: ${outputPath}`));
  }

  async createBranch() {
    // Check if branch already exists
    const branches = await this.git.branch();
    if (branches.all.includes(BRANCH_NAME)) {
      console.log(chalk.yellow(`\n⚠️  Branch ${BRANCH_NAME} already exists. Deleting and recreating...`));
      await this.git.deleteLocalBranch(BRANCH_NAME, true);
    }
    
    // Create new branch
    await this.git.checkoutLocalBranch(BRANCH_NAME);
  }

  async runClaudeCode() {
    // Change to repo directory for Claude Code execution
    process.chdir(this.repoPath);
    
    // Create the command to run
    const migrationPrompt = `Please read the CLAUDE.md file in this repository and execute all the migration steps described there. Apply all changes systematically, create all tests, and ensure everything works.`;
    
    console.log(chalk.gray('\nRunning Claude Code in CLI mode...'));
    console.log(chalk.gray('This will apply all migrations automatically.\n'));

    try {
      // Run Claude Code in print mode with max turns for thorough completion
      await execa('claude', [
        '--print',
        '--max-turns', '30',
        '--model', 'opus',
        '--dangerously-skip-permissions',
        migrationPrompt
      ], {
        stdio: 'inherit',
        cwd: this.repoPath
      });
      
      // After Claude completes, run tests to verify
      console.log(chalk.yellow('\n📋 Running tests to verify migration...'));
      
      try {
        await execa('npm', ['test'], {
          stdio: 'inherit',
          cwd: this.repoPath
        });
        console.log(chalk.green('✅ All tests passing!'));
      } catch (testError) {
        console.log(chalk.yellow('⚠️  Some tests failed. You may need to fix them manually.'));
      }
      
    } catch (error) {
      // If claude command not found, provide instructions
      if (error.code === 'ENOENT') {
        console.log(chalk.yellow('\n⚠️  Claude Code not found!'));
        console.log(chalk.gray('Please install Claude Code first:'));
        console.log(chalk.cyan('  npm install -g @anthropic-ai/claude-code'));
        console.log(chalk.gray('\nThen run the following command in the repository:'));
        console.log(chalk.cyan(`  cd ${this.repoPath}`));
        console.log(chalk.cyan(`  claude --print --max-turns 30 --dangerously-skip-permissions "${migrationPrompt}"`));
      } else {
        throw error;
      }
    }
  }
}

// CLI setup
program
  .name('eliza-upgrade')
  .description('Automatically migrate Eliza plugins from 0.x to 1.x using Claude Code')
  .version('1.0.0')
  .argument('<input>', 'GitHub repository URL or local folder path')
  .option('--api-key <key>', 'Anthropic API key (or use ANTHROPIC_API_KEY env var)')
  .action(async (input, options) => {
    // Set API key if provided via CLI
    if (options.apiKey) {
      process.env.ANTHROPIC_API_KEY = options.apiKey;
    }
    
    const upgrader = new PluginUpgrader();
    await upgrader.run(input);
  });

program.parse(); 