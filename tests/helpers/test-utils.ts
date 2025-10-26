import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Test ProjectConfig type (input)
 */
export interface TestProjectConfigInput {
  name?: string;
  description?: string;
  architecture?: {
    appRouter?: boolean;
    typescript?: boolean;
    packageManager?: string;
    database?: string;
    orm?: string;
    auth?: string;
    uiLibrary?: string;
    stateManagement?: string;
    testing?: string;
  };
}

/**
 * Test ProjectConfig type (output - always has all fields)
 */
export interface TestProjectConfig {
  name: string;
  description: string;
  architecture: {
    appRouter: boolean;
    typescript: boolean;
    packageManager: string;
    database: string;
    orm: string;
    auth: string;
    uiLibrary: string;
    stateManagement: string;
    testing: string;
  };
}

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(prefix = 'next-mcp-test-'): Promise<string> {
  const tempPath = path.join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).substring(7)}`);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to cleanup temp directory ${dirPath}:`, error);
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file content as string
 */
export async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Check if a directory exists
 */
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Execute a command and return output
 */
export function execCommand(command: string, cwd?: string): string {
  return execSync(command, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Create a mock ProjectConfig for testing
 */
export function createMockConfig(overrides?: TestProjectConfigInput): TestProjectConfig {
  return {
    name: overrides?.name || 'test-app',
    description: overrides?.description || 'A test Next.js application',
    architecture: {
      appRouter: true,
      typescript: true,
      packageManager: 'pnpm',
      database: 'postgres',
      orm: 'prisma',
      auth: 'better-auth',
      uiLibrary: 'shadcn',
      stateManagement: 'none',
      testing: 'vitest',
      ...(overrides?.architecture || {}),
    },
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Create a basic package.json for testing
 */
export async function createPackageJson(dirPath: string, config?: { name?: string }): Promise<void> {
  const packageJson = {
    name: config?.name || 'test-project',
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
    },
    dependencies: {},
    devDependencies: {},
  };

  await fs.writeFile(path.join(dirPath, 'package.json'), JSON.stringify(packageJson, null, 2));
}

/**
 * Create a mock Next.js project structure simulating what create-next-app would create
 * This includes the basic directory structure and configuration files
 */
export async function createNextAppMock(
  dirPath: string,
  options?: {
    name?: string;
    typescript?: boolean;
    appRouter?: boolean;
  }
): Promise<void> {
  const { name = 'test-project', typescript = true, appRouter = true } = options || {};

  // Create package.json
  await createPackageJson(dirPath, { name });

  // Create base directories
  await fs.mkdir(path.join(dirPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(dirPath, 'public'), { recursive: true });

  if (appRouter) {
    // App Router structure
    await fs.mkdir(path.join(dirPath, 'src/app'), { recursive: true });
    await fs.mkdir(path.join(dirPath, 'src/app/api'), { recursive: true });

    // Create a basic page.tsx/page.js
    const pageExt = typescript ? 'tsx' : 'jsx';
    const pageContent = `export default function Home() {
  return (
    <main>
      <h1>Welcome to ${name}</h1>
    </main>
  );
}
`;
    await fs.writeFile(path.join(dirPath, `src/app/page.${pageExt}`), pageContent);

    // Create layout.tsx/layout.js
    const layoutContent = `export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
    await fs.writeFile(path.join(dirPath, `src/app/layout.${pageExt}`), layoutContent);
  } else {
    // Pages Router structure
    await fs.mkdir(path.join(dirPath, 'src/pages'), { recursive: true });
    await fs.mkdir(path.join(dirPath, 'src/pages/api'), { recursive: true });

    const indexExt = typescript ? 'tsx' : 'jsx';
    const indexContent = `export default function Home() {
  return (
    <div>
      <h1>Welcome to ${name}</h1>
    </div>
  );
}
`;
    await fs.writeFile(path.join(dirPath, `src/pages/index.${indexExt}`), indexContent);
  }

  // Create next.config file
  const configExt = typescript ? 'ts' : 'js';
  const nextConfigContent = typescript
    ? `import type { NextConfig } from 'next';

const config: NextConfig = {
  /* config options here */
};

export default config;
`
    : `/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
};

module.exports = nextConfig;
`;
  await fs.writeFile(path.join(dirPath, `next.config.${configExt}`), nextConfigContent);

  // Create tsconfig.json (if TypeScript)
  if (typescript) {
    const tsconfigContent = {
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [
          {
            name: 'next',
          },
        ],
        paths: {
          '@/*': ['./src/*'],
        },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    };
    await fs.writeFile(path.join(dirPath, 'tsconfig.json'), JSON.stringify(tsconfigContent, null, 2));
  }

  // Create .gitignore
  const gitignoreContent = `# dependencies
/node_modules
/.pnp
.pnp.js

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
`;
  await fs.writeFile(path.join(dirPath, '.gitignore'), gitignoreContent);

  // Create README.md
  const readmeContent = `# ${name}

This is a [Next.js](https://nextjs.org) project bootstrapped with [\`create-next-app\`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

\`\`\`bash
npm run dev
# or
yarn dev
# or
pnpm dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
`;
  await fs.writeFile(path.join(dirPath, 'README.md'), readmeContent);
}

/**
 * Verify basic Next.js project structure
 */
export async function verifyNextJsStructure(projectPath: string): Promise<{
  hasPackageJson: boolean;
  hasSrcDir: boolean;
  hasAppDir: boolean;
  hasNextConfig: boolean;
  hasTsConfig: boolean;
}> {
  return {
    hasPackageJson: await fileExists(path.join(projectPath, 'package.json')),
    hasSrcDir: await dirExists(path.join(projectPath, 'src')),
    hasAppDir: await dirExists(path.join(projectPath, 'src/app')),
    hasNextConfig: await fileExists(path.join(projectPath, 'next.config.ts')),
    hasTsConfig: await fileExists(path.join(projectPath, 'tsconfig.json')),
  };
}
