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
const CONCURRENCY_LIMIT = 10;

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
    const spinner = ora(`Processing ${input}`);
    
    try {
      spinner.start();
      // Initialize Anthropic (required)
      // Ensure it's initialized per instance if run was called multiple times by an external loop
      if (!this.anthropic) await this.initializeAnthropic();

      // Step 1: Handle input (GitHub URL or local folder)
      spinner.text = `Analyzing input for ${input}...`;
      await this.handleInput(input);
      spinner.succeed(`Input validated for ${input}`);

      // Check if CLAUDE.md already exists
      const claudeMdPath = path.join(this.repoPath, 'CLAUDE.md');
      let skipGeneration = false;
      
      if (await fs.pathExists(claudeMdPath)) {
        spinner.info(`${chalk.yellow('[SKIP]')} CLAUDE.md already exists in ${this.repoPath}. Skipping generation.`);
        skipGeneration = true;
      }

      if (!skipGeneration) {
        // Step 2: Analyze repository
        spinner.text = `Analyzing repository structure for ${this.repoPath}...`;
        const context = await this.analyzeRepository();
        spinner.succeed(`Repository analyzed for ${this.repoPath}`);

        // Step 3: Generate specific migration strategy
        spinner.text = `Generating specific migration strategy for ${this.repoPath}...`;
        const specificStrategy = await this.generateMigrationStrategy(context);
        spinner.succeed(`Migration strategy generated for ${this.repoPath}`);

        // Step 4: Create CLAUDE.md with specific instructions
        spinner.text = `Creating migration instructions file for ${this.repoPath}...`;
        await this.createMigrationInstructions(specificStrategy);
        spinner.succeed(`Migration instructions created for ${this.repoPath}`);
      }

      // Step 5: Create new branch
      spinner.text = `Creating branch ${BRANCH_NAME} for ${this.repoPath}...`;
      await this.createBranch();
      spinner.succeed(`Branch ${BRANCH_NAME} created for ${this.repoPath}`);

      // Step 6: Run Claude Code in CLI mode
      spinner.text = `${chalk.yellow('[ACTION]')} Running Claude Code to apply migrations for ${this.repoPath}...`;
      await this.runClaudeCode();
      spinner.succeed(`Claude Code finished for ${this.repoPath}`);
      
      // Step 7: Push the new branch
      spinner.text = `Pushing branch ${BRANCH_NAME} to origin for ${this.repoPath}...`;
      await this.git.push('origin', BRANCH_NAME, {'--set-upstream': null});
      spinner.succeed(`Branch ${BRANCH_NAME} pushed for ${this.repoPath}`);

      console.log(chalk.green(`\n✅ Migration complete for ${input}!`));
      
    } catch (error) {
      spinner.fail(`Migration failed for ${input}`);
      console.error(chalk.red(`\n❌ Error processing ${input}:`), error.message);
      if (error.stack) {
        // console.error(chalk.gray(error.stack)); // Potentially too verbose for batch
      }
      // Do not exit process in batch mode, throw error to be caught by batch processor
      throw error;
    }
  }

  async handleInput(input) {
    // Check if input is a GitHub URL
    if (input.startsWith('https://github.com/')) {
      this.isGitHub = true;
      this.originalPath = input;
      
      const repoName = input.split('/').slice(-2).join('/').replace('.git', '');
      this.repoPath = path.join(process.cwd(), 'cloned_repos', repoName.split('/')[1] || repoName);
      await fs.ensureDir(path.dirname(this.repoPath));
      
      if (await fs.pathExists(this.repoPath)) {
        // console.log(chalk.yellow(`\n📁 Using existing folder: ${this.repoPath}`));
        this.git = simpleGit(this.repoPath);
        try {
            await this.git.fetch(); // Fetch latest changes
        } catch (fetchError) {
            // console.warn(chalk.yellow(`Could not fetch for ${this.repoPath}, possibly a new clone. Error: ${fetchError.message}`));
            // If fetch fails, could be a corrupted local repo or new clone. Try to delete and re-clone.
            // console.log(chalk.yellow(`Attempting to delete and re-clone ${this.repoPath}...`));
            await fs.remove(this.repoPath);
            await simpleGit().clone(input, this.repoPath);
            this.git = simpleGit(this.repoPath);
        }
      } else {
        // console.log(chalk.yellow(`\n📥 Cloning repository ${input} into ${this.repoPath}...`));
        await simpleGit().clone(input, this.repoPath);
        this.git = simpleGit(this.repoPath);
      }
      
      const branches = await this.git.branch();
      if (branches.all.includes('remotes/origin/0.x') || branches.all.includes('0.x')) {
        if (branches.current !== '0.x') await this.git.checkout('0.x');
        // console.log(chalk.gray(`Checked out 0.x branch for ${this.repoPath}`));
      } else if (branches.all.includes('remotes/origin/main') || branches.all.includes('main')) {
        if (branches.current !== 'main') await this.git.checkout('main');
        // console.log(chalk.gray(`No 0.x branch found, using main for ${this.repoPath}`));
      }
    } else {
      // Local folder (less relevant for batch GitHub processing but kept for single mode)
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
      ignore: ['node_modules/**', 'dist/**', 'build/**', '*.test.*', '*.spec.*', 'coverage/**', 'cloned_repos/**']
    });

    // Read source files and calculate tokens
    let totalTokens = 0;
    const readmeTokens = files.readme ? encoder.encode(files.readme).length : 0;
    const packageTokens = files.packageJson ? encoder.encode(files.packageJson).length : 0;
    const indexTokens = files.index ? encoder.encode(files.index.content).length : 0;
    
    totalTokens = readmeTokens + packageTokens + indexTokens;

    const sortedFiles = sourceFiles.sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    for (const file of sortedFiles) {
      if (file === files.index?.path) continue;
      const filePath = path.join(this.repoPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const fileTokens = encoder.encode(content).length;
      if (totalTokens + fileTokens > MAX_TOKENS) break;
      files.sourceFiles.push({ path: file, content: content });
      totalTokens += fileTokens;
    }
    // console.log(chalk.gray(`\nTotal tokens for ${this.repoPath}: ${totalTokens}/${MAX_TOKENS}`));
    let context = '';
    if (files.readme) context += '# README.md\n\n' + files.readme + '\n\n';
    if (files.packageJson) context += '# package.json\n\n```json\n' + files.packageJson + '\n```\n\n';
    if (files.index) context += `# ${files.index.path}\n\n\`\`\`typescript\n${files.index.content}\n\`\`\`\n\n`;
    for (const file of files.sourceFiles) context += `# ${file.path}\n\n\`\`\`typescript\n${file.content}\n\`\`\`\n\n`;
    return context;
  }

  async generateMigrationStrategy(context) {
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
      throw error;
    }
  }

  async createMigrationInstructions(specificStrategy) {
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
    // console.log(chalk.gray(`\nMigration instructions written to: ${outputPath}`));
  }

  async createBranch() {
    const branches = await this.git.branch();
    const currentBranch = branches.current;
    if (branches.all.includes(BRANCH_NAME) || branches.all.includes(`remotes/origin/${BRANCH_NAME}`)) {
        if(currentBranch !== BRANCH_NAME) {
            // console.log(chalk.yellow(`Switching to existing branch ${BRANCH_NAME} for ${this.repoPath}`));
            try {
                await this.git.checkout(BRANCH_NAME);
            } catch (e) {
                 // console.log(chalk.yellow(`Local branch ${BRANCH_NAME} not found or has issues, trying to fetch from origin and recreate for ${this.repoPath}`));
                await this.git.fetch('origin', BRANCH_NAME).catch(() => {}); // fetch if exists
                await this.git.deleteLocalBranch(BRANCH_NAME, true).catch(() => {}); // delete local if exists
                await this.git.checkoutBranch(BRANCH_NAME, `origin/${BRANCH_NAME}`).catch(async () => {
                    // If origin/BRANCH_NAME doesn't exist, create it fresh from current branch
                    // console.log(chalk.yellow(`Branch ${BRANCH_NAME} not on origin, creating new from ${currentBranch} for ${this.repoPath}`));
                    await this.git.checkout(currentBranch); // ensure back on a valid branch
                    await this.git.checkoutLocalBranch(BRANCH_NAME);
                });
            }
        }
    } else {
        // console.log(chalk.yellow(`Creating new branch ${BRANCH_NAME} from ${currentBranch} for ${this.repoPath}`));
        await this.git.checkoutLocalBranch(BRANCH_NAME);
    }
  }

  async runClaudeCode() {
    process.chdir(this.repoPath);
    const migrationPrompt = `Please read the CLAUDE.md file in this repository and execute all the migration steps described there. Apply all changes systematically, create all tests, and ensure everything works.`;
    // console.log(chalk.gray('\nRunning Claude Code in CLI mode...'));
    try {
      await execa('claude', [
        '--print',
        '--max-turns', '30',
        '--verbose',
        '--model', 'opus',
        '--dangerously-skip-permissions',
        migrationPrompt
      ], { stdio: 'inherit', cwd: this.repoPath });
      // console.log(chalk.yellow('\n📋 Running tests to verify migration...'));
      try {
        await execa('npm', ['test'], { stdio: 'inherit', cwd: this.repoPath });
        // console.log(chalk.green('✅ All tests passing!'));
      } catch (testError) {
        // console.warn(chalk.yellow('⚠️  Some tests failed. You may need to fix them manually.'));
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(chalk.red('\n⚠️  Claude Code not found! Install with: npm install -g @anthropic-ai/claude-code'));
        console.error(chalk.gray(`Manual command for ${this.repoPath}: cd ${this.repoPath} && claude --print --max-turns 30 --model opus --dangerously-skip-permissions "${migrationPrompt}"`));
      } else {
        throw error; // Rethrow for batch processor to catch
      }
    }
  }
}

async function checkRemoteBranches(repoUrl) {
  try {
    const remoteLs = await simpleGit().listRemote(['--heads', repoUrl]);
    return remoteLs.includes(`refs/heads/${BRANCH_NAME}`) || remoteLs.includes('refs/heads/1.x');
  } catch (e) {
    // console.warn(chalk.yellow(`Could not list remote branches for ${repoUrl}: ${e.message}. Assuming no upgrade branches.`));
    return false; // If can't list, assume not present and try to process
  }
}

async function processSingleRepo(repoUrl, sharedAnthropicInstance) {
  const upgrader = new PluginUpgrader();
  upgrader.anthropic = sharedAnthropicInstance; // Share the initialized Anthropic instance
  await upgrader.run(repoUrl);
}

async function runBatch(registryUrlOrPath) {
  let registry;
  const mainSpinner = ora('Starting batch processing...').start();
  
  try {
    if (registryUrlOrPath.startsWith('http')) {
      mainSpinner.text = `Fetching registry from ${registryUrlOrPath}...`;
      const response = await fetch(registryUrlOrPath);
      if (!response.ok) throw new Error(`Failed to fetch registry: ${response.statusText}`);
      registry = await response.json();
    } else {
      mainSpinner.text = `Reading registry from local path ${registryUrlOrPath}...`;
      registry = JSON.parse(await fs.readFile(registryUrlOrPath, 'utf-8'));
    }
    mainSpinner.succeed('Registry loaded.');
  } catch (e) {
    mainSpinner.fail(`Failed to load registry: ${e.message}`);
    process.exit(1);
  }

  const repoTasks = [];
  const sharedAnthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if (!process.env.ANTHROPIC_API_KEY) {
    mainSpinner.fail('ANTHROPIC_API_KEY is not set. Cannot proceed with batch processing.');
    process.exit(1);
  }

  for (const [key, value] of Object.entries(registry)) {
    if (typeof value === 'string' && value.startsWith('github:')) {
      const repoPath = value.substring('github:'.length);
      const repoUrl = `https://github.com/${repoPath}.git`;
      repoTasks.push({ name: key, url: repoUrl });
    }
  }
  
  mainSpinner.info(`Found ${repoTasks.length} plugins to process.`);
  const tasksToRun = [];
  const preCheckSpinner = ora('Checking existing branches for plugins...').start();
  let count = 0;
  for (const task of repoTasks) {
    count++;
    preCheckSpinner.text = `Checking ${count}/${repoTasks.length}: ${task.name}`;
    if (await checkRemoteBranches(task.url)) {
      preCheckSpinner.info(`${chalk.cyan('[SKIP]')} ${task.name} already has 1.x or ${BRANCH_NAME} branch.`);
    } else {
      tasksToRun.push(() => processSingleRepo(task.url, sharedAnthropic)
        .catch(e => console.error(chalk.magenta(`\n‼️ Failed to process ${task.name}: ${e.message}`)))
      );
    }
  }
  preCheckSpinner.succeed(`Branch checks complete. ${tasksToRun.length} plugins need processing.`);

  if (tasksToRun.length === 0) {
    mainSpinner.succeed('No plugins require migration.');
    return;
  }

  mainSpinner.info(`Starting migration for ${tasksToRun.length} plugins with concurrency ${CONCURRENCY_LIMIT}...`);
  
  const executing = [];
  let completedCount = 0;
  let failedCount = 0;

  for (const taskFn of tasksToRun) {
    const p = taskFn()
      .then(() => { completedCount++; })
      .catch(() => { failedCount++; })
      .finally(() => {
        mainSpinner.text = `Processing plugins... (${completedCount} completed, ${failedCount} failed / ${tasksToRun.length} total)`
        executing.splice(executing.indexOf(p), 1)
      });
    
    executing.push(p);

    if (executing.length >= CONCURRENCY_LIMIT) {
      await Promise.race(executing).catch(() => {}); // Wait for one to finish, catch to prevent unhandled rejection if a task fails
    }
  }
  
  await Promise.allSettled(executing); // Wait for all remaining tasks
  mainSpinner.succeed(`Batch processing finished. ${completedCount} succeeded, ${failedCount} failed.`);
}

program
  .name('eliza-upgrade')
  .description('Automatically migrate Eliza plugins from 0.x to 1.x using Claude Code')
  .version('1.0.0')
  .argument('[input]', 'GitHub repository URL or local folder path')
  .option('--registry <url_or_path>', 'URL or local path to a JSON registry of plugins')
  .option('--api-key <key>', 'Anthropic API key (or use ANTHROPIC_API_KEY env var)')
  .action(async (input, options) => {
    if (options.apiKey) {
      process.env.ANTHROPIC_API_KEY = options.apiKey;
    }

    if (options.registry) {
      await runBatch(options.registry);
    } else if (input) {
      const upgrader = new PluginUpgrader();
      await upgrader.run(input);
    } else {
      console.log(chalk.red('Please provide an input repository or a registry URL.'));
      program.help();
    }
  });

program.parse(); 