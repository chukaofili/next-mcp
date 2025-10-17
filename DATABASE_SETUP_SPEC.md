# Database Setup Implementation Specification

## Overview

This document outlines the complete implementation plan for setting up database configurations in the Next.js MCP scaffolding tool. The database must be properly configured BEFORE authentication setup, as auth requires database tables.

---

## Execution Order

**CRITICAL**: Database setup must happen BEFORE authentication setup:

1. ✅ `setupDatabase()` - Configure database, ORM, and create base schema
2. ✅ `setupAuthentication()` - Add auth-specific tables/models to existing database

---

## 1. Supported Configurations

### Database Options

- `postgres` - PostgreSQL
- `mysql` - MySQL/MariaDB
- `sqlite` - SQLite
- `mongodb` - MongoDB
- `none` - No database

### ORM Options

- `prisma` - Prisma ORM (supports all databases)
- `drizzle` - Drizzle ORM (supports postgres, mysql, sqlite)
- `mongoose` - Mongoose ODM (MongoDB only)
- `none` - Direct database drivers

### Valid Combinations Matrix

| Database | Prisma | Drizzle | Mongoose | None (Direct) |
| -------- | ------ | ------- | -------- | ------------- |
| postgres | ✅     | ✅      | ❌       | ✅            |
| mysql    | ✅     | ✅      | ❌       | ✅            |
| sqlite   | ✅     | ✅      | ❌       | ✅            |
| mongodb  | ✅     | ❌      | ✅       | ✅            |
| none     | ❌     | ❌      | ❌       | ✅            |

---

## 2. File Structure by ORM

### Prisma Configuration

```
project-root/
├── prisma/
│   ├── schema.prisma              # Database schema
│   └── migrations/                # Migration files
├── src/
│   └── lib/
│       └── db/
│           ├── generated/
│           │   └── prisma/        # Generated Prisma client
│           ├── client.ts          # Prisma client instance
│           └── index.ts           # Exported db utilities
├── .env.example
└── .env.local
```

**Note**: Prisma client is generated to a custom location (`src/lib/db/generated/prisma`) for better organization and to keep generated code separate from source code.

### Drizzle Configuration

```
project-root/
├── drizzle/
│   └── migrations/                # Migration files (generated)
├── src/
│   └── lib/
│       └── db/
│           ├── schema.ts          # Database schema
│           ├── client.ts          # Database connection
│           └── index.ts           # Exported db utilities
├── drizzle.config.ts              # Drizzle configuration
├── .env.example
└── .env.local
```

### Mongoose Configuration

```
project-root/
├── src/
│   └── lib/
│       └── db/
│           ├── models/            # Mongoose models
│           │   └── index.ts
│           ├── connection.ts      # MongoDB connection
│           └── index.ts           # Exported db utilities
├── .env.example
└── .env.local
```

### Direct Database Driver

```
project-root/
├── src/
│   └── lib/
│       └── db/
│           ├── connection.ts      # Database connection
│           └── index.ts           # Exported db utilities
├── .env.example
└── .env.local
```

---

## 3. Environment Variables by Database

### PostgreSQL

```env
# PostgreSQL Configuration
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public"

# Alternative format (for direct drivers)
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="dbname"
DB_USER="user"
DB_PASSWORD="password"
```

### MySQL

```env
# MySQL Configuration
DATABASE_URL="mysql://user:password@localhost:3306/dbname"

# Alternative format (for direct drivers)
DB_HOST="localhost"
DB_PORT="3306"
DB_NAME="dbname"
DB_USER="user"
DB_PASSWORD="password"
```

### SQLite

```env
# SQLite Configuration
DATABASE_URL="file:./dev.db"
```

### MongoDB

```env
# MongoDB Configuration
DATABASE_URL="mongodb://localhost:27017/dbname"

# With auth
DATABASE_URL="mongodb://user:password@localhost:27017/dbname?authSource=admin"
```

---

## 4. Template Files to Create

### Prisma Templates

**Note**: No schema template needed - `npx prisma init` creates the initial schema. Better-auth will add its models when authentication is set up.

#### `src/templates/database/prisma/client.ts.template`

```typescript
import { PrismaClient } from './generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

**Note**: Imports from custom output directory `./generated/prisma`.

#### `src/templates/database/prisma/index.ts.template`

```typescript
export { prisma as db } from './client';
export type { PrismaClient } from './generated/prisma';
```

### Drizzle Templates

#### `src/templates/database/drizzle/drizzle.config.ts.template`

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: '__DIALECT__',
  dbCredentials: __DB_CREDENTIALS__,
});
```

**Placeholders:**

- `__DIALECT__`: `postgresql`, `mysql`, or `sqlite`
- `__DB_CREDENTIALS__`: Database-specific credentials object

#### `src/templates/database/drizzle/schema.ts.template`

```typescript
import { __IMPORTS__ } from 'drizzle-orm/__DIALECT_CORE__';

// Example User table (can be extended)
export const users = __TABLE_FUNCTION__('users', {
  id: __ID_TYPE__('id').__PRIMARY_KEY__,
  email: __TEXT_TYPE__('email').__NOT_NULL__.__UNIQUE__,
  name: __TEXT_TYPE__('name'),
  createdAt: __TIMESTAMP_TYPE__('created_at').__DEFAULT_NOW__.__NOT_NULL__,
  updatedAt: __TIMESTAMP_TYPE__('updated_at').__DEFAULT_NOW__.__NOT_NULL__,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

**Placeholders vary by database dialect**

#### `src/templates/database/drizzle/client.ts.template`

```typescript
__DRIVER_IMPORT__;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

__CONNECTION_CODE__;

export { db };
```

#### `src/templates/database/drizzle/index.ts.template`

```typescript
export { db } from './client';
export * from './schema';
```

### Mongoose Templates

#### `src/templates/database/mongoose/connection.ts.template`

```typescript
import mongoose from 'mongoose';

const MONGODB_URI = process.env.DATABASE_URL;

if (!MONGODB_URI) {
  throw new Error('Please define the DATABASE_URL environment variable');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectDB;
```

#### `src/templates/database/mongoose/models/user.ts.template`

```typescript
import mongoose, { model, models, Schema } from 'mongoose';

export interface IUser {
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const User = models.User || model<IUser>('User', UserSchema);
```

#### `src/templates/database/mongoose/index.ts.template`

```typescript
export { default as connectDB } from './connection';
export * from './models/user';
```

### Direct Database Driver Templates

#### `src/templates/database/direct/postgres.ts.template`

```typescript
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Helper function to query
export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text, duration, rows: res.rowCount });
  return res;
}

export const db = pool;
```

#### `src/templates/database/direct/mysql.ts.template`

```typescript
import mysql from 'mysql2/promise';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const pool = mysql.createPool({
  uri: connectionString,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Helper function to query
export async function query(sql: string, values?: any[]) {
  const [results] = await pool.execute(sql, values);
  return results;
}

export const db = pool;
```

#### `src/templates/database/direct/sqlite.ts.template`

```typescript
import path from 'path';

import Database from 'better-sqlite3';

const dbPath = path.join(process.cwd(), 'dev.db');
export const db = new Database(dbPath, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
});

// Enable foreign keys
db.pragma('foreign_keys = ON');

export default db;
```

---

## 5. Drizzle Schema Templates by Database

### PostgreSQL Schema

```typescript
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### MySQL Schema

```typescript
import { mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### SQLite Schema

```typescript
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
});
```

---

## 6. Drizzle Client Templates by Database

### PostgreSQL Client

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

### MySQL Client

```typescript
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

import * as schema from './schema';

const poolConnection = mysql.createPool({
  uri: process.env.DATABASE_URL,
});

export const db = drizzle(poolConnection, { schema, mode: 'default' });
```

### SQLite Client

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

const sqlite = new Database('dev.db');
export const db = drizzle(sqlite, { schema });
```

---

## 7. Implementation Steps for `setupDatabase` Method

### Step 1: Validate Configuration

```typescript
if (config.architecture.database === 'none') {
  return {
    content: [
      {
        type: 'text',
        text: 'No database configuration needed',
      },
    ],
  };
}

// Validate ORM/Database compatibility
const validCombinations = {
  prisma: ['postgres', 'mysql', 'sqlite', 'mongodb'],
  drizzle: ['postgres', 'mysql', 'sqlite'],
  mongoose: ['mongodb'],
  none: ['postgres', 'mysql', 'sqlite', 'mongodb'],
};

const { orm, database } = config.architecture;
if (orm !== 'none' && !validCombinations[orm]?.includes(database)) {
  throw new Error(
    `Invalid combination: ${orm} does not support ${database}. ` +
      `Valid databases for ${orm}: ${validCombinations[orm].join(', ')}`
  );
}
```

### Step 2: Create Directory Structure

```typescript
const dbDirs = ['src/lib/db'];

if (orm === 'prisma') {
  // prisma/ directory will be created by `npx prisma init`
  // No need to create it manually
} else if (orm === 'drizzle') {
  dbDirs.push('drizzle/migrations');
} else if (orm === 'mongoose') {
  dbDirs.push('src/lib/db/models');
}

for (const dir of dbDirs) {
  await fs.mkdir(path.join(projectPath, dir), { recursive: true });
}
```

**Note**: For Prisma, the `prisma/` directory and initial `schema.prisma` file are created automatically by `npx prisma init`.

### Step 3: Generate Environment Variables

```typescript
const databaseUrl = getDatabaseUrl(config);
const envContent = `# Database Configuration
DATABASE_URL="${databaseUrl}"
`;

// Append to .env.example
await fs.appendFile(path.join(projectPath, '.env.example'), envContent);
await fs.appendFile(path.join(projectPath, '.env.local'), envContent);
```

### Step 4: Generate ORM Configuration Files

#### For Prisma

```typescript
// Run prisma init with CLI using the selected package manager
const provider = getPrismaProvider(config.architecture.database);
const runner = getPackageRunner(config.architecture.packageManager);
const prismaInitCommand = `${runner} prisma init --datasource-provider ${provider}`;

try {
  execSync(prismaInitCommand, {
    cwd: projectPath,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  logger.info(`Prisma initialized with provider: ${provider} using ${runner}`);
} catch (error) {
  logger.error('Failed to initialize Prisma:', error);
  throw new Error(`Prisma initialization failed: ${error.message}`);
}

// Update schema.prisma to use custom output directory
const schemaPath = path.join(projectPath, 'prisma/schema.prisma');
let schemaContent = await fs.readFile(schemaPath, 'utf-8');

// Update generator to use custom output
schemaContent = schemaContent.replace(
  /generator client \{[\s\S]*?\}/,
  `generator client {
  provider = "prisma-client-js"
  output   = "../src/lib/db/generated/prisma"
}`
);

await fs.writeFile(schemaPath, schemaContent);

// Write Prisma client wrapper
const clientTemplate = await fs.readFile(
  path.join(__dirname, 'templates/database/prisma/client.ts.template'),
  'utf-8'
);
await fs.writeFile(
  path.join(projectPath, 'src/lib/db/client.ts'),
  clientTemplate
);

// Write index
const indexTemplate = await fs.readFile(
  path.join(__dirname, 'templates/database/prisma/index.ts.template'),
  'utf-8'
);
await fs.writeFile(
  path.join(projectPath, 'src/lib/db/index.ts'),
  indexTemplate
);

// Add generated folder to .gitignore
const gitignorePath = path.join(projectPath, '.gitignore');
let gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
if (!gitignoreContent.includes('src/lib/db/generated')) {
  gitignoreContent += '\n# Prisma generated client\n/src/lib/db/generated/\n';
  await fs.writeFile(gitignorePath, gitignoreContent);
}
```

#### For Drizzle

```typescript
// Generate drizzle.config.ts
const drizzleConfigTemplate = await fs.readFile(
  path.join(__dirname, 'templates/database/drizzle/drizzle.config.ts.template'),
  'utf-8'
);

const dialect = getDrizzleDialect(config.architecture.database);
const credentials = getDrizzleCredentials(config.architecture.database);

const configContent = drizzleConfigTemplate.replace('__DIALECT__', dialect).replace('__DB_CREDENTIALS__', credentials);

await fs.writeFile(path.join(projectPath, 'drizzle.config.ts'), configContent);

// Generate schema
const schemaContent = generateDrizzleSchema(config.architecture.database);
await fs.writeFile(path.join(projectPath, 'src/lib/db/schema.ts'), schemaContent);

// Generate client
const clientContent = generateDrizzleClient(config.architecture.database);
await fs.writeFile(path.join(projectPath, 'src/lib/db/client.ts'), clientContent);

// Generate index
await fs.writeFile(
  path.join(projectPath, 'src/lib/db/index.ts'),
  `export { db } from './client';\nexport * from './schema';`
);
```

#### For Mongoose

```typescript
// Generate connection
const connectionTemplate = await fs.readFile(
  path.join(__dirname, 'templates/database/mongoose/connection.ts.template'),
  'utf-8'
);
await fs.writeFile(path.join(projectPath, 'src/lib/db/connection.ts'), connectionTemplate);

// Generate User model
const userModelTemplate = await fs.readFile(
  path.join(__dirname, 'templates/database/mongoose/models/user.ts.template'),
  'utf-8'
);
await fs.writeFile(path.join(projectPath, 'src/lib/db/models/user.ts'), userModelTemplate);

// Generate index
const indexTemplate = await fs.readFile(path.join(__dirname, 'templates/database/mongoose/index.ts.template'), 'utf-8');
await fs.writeFile(path.join(projectPath, 'src/lib/db/index.ts'), indexTemplate);
```

#### For Direct Drivers

```typescript
const driverTemplate = await fs.readFile(
  path.join(__dirname, `templates/database/direct/${config.architecture.database}.ts.template`),
  'utf-8'
);
await fs.writeFile(path.join(projectPath, 'src/lib/db/index.ts'), driverTemplate);
```

### Step 5: Add Post-Setup Instructions

```typescript
const instructions = generateInstructions(config);

return {
  content: [
    {
      type: 'text',
      text: instructions,
    },
  ],
};
```

---

## 8. Helper Functions

### `getDatabaseUrl(config: ProjectConfig): string`

```typescript
function getDatabaseUrl(config: ProjectConfig): string {
  const { database } = config.architecture;
  const projectName = config.name;

  switch (database) {
    case 'postgres':
      return `postgresql://postgres:postgres@localhost:5432/${projectName}`;
    case 'mysql':
      return `mysql://root:password@localhost:3306/${projectName}`;
    case 'sqlite':
      return 'file:./dev.db';
    case 'mongodb':
      return `mongodb://localhost:27017/${projectName}`;
    default:
      return '';
  }
}
```

### `getPackageRunner(packageManager: string): string`

```typescript
function getPackageRunner(packageManager: string): string {
  // Returns the appropriate command runner for executing packages
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm exec';
    case 'yarn':
      return 'yarn';
    case 'bun':
      return 'bunx';
    case 'npm':
    default:
      return 'npx';
  }
}
```

**Note**: This helper ensures Prisma (and other tool) commands use the user's selected package manager.

### `getPrismaProvider(database: string): string`

```typescript
function getPrismaProvider(database: string): string {
  // Maps our internal database names to Prisma's datasource-provider values
  const providerMap = {
    postgres: 'postgresql',
    mysql: 'mysql',
    sqlite: 'sqlite',
    mongodb: 'mongodb',
  };
  return providerMap[database] || 'postgresql';
}
```

**Note**: These provider names match Prisma's `--datasource-provider` flag values.

### `getDrizzleDialect(database: string): string`

```typescript
function getDrizzleDialect(database: string): string {
  const dialectMap = {
    postgres: 'postgresql',
    mysql: 'mysql',
    sqlite: 'sqlite',
  };
  return dialectMap[database] || 'postgresql';
}
```

### `generateInstructions(config: ProjectConfig): string`

```typescript
function generateInstructions(config: ProjectConfig): string {
  const { database, orm } = config.architecture;
  const pm = config.architecture.packageManager;

  let instructions = `✅ Database configuration complete!\n\n`;
  instructions += `📋 Next Steps:\n\n`;

  if (orm === 'prisma') {
    const runner = getPackageRunner(pm);

    instructions += `1. Generate Prisma Client:\n   ${runner} prisma generate\n\n`;
    instructions += `2. Create and apply initial migration:\n   ${runner} prisma migrate dev --name init\n\n`;
    instructions += `3. (Optional) Open Prisma Studio to view/edit data:\n   ${runner} prisma studio\n\n`;
    instructions += `4. Update your schema in prisma/schema.prisma and run:\n   ${runner} prisma generate\n   ${runner} prisma migrate dev\n\n`;
  } else if (orm === 'drizzle') {
    instructions += `1. Generate migration files:\n   ${pm} exec drizzle-kit generate\n\n`;
    instructions += `2. Apply migrations:\n   ${pm} exec drizzle-kit migrate\n\n`;
    instructions += `3. (Optional) Open Drizzle Studio:\n   ${pm} exec drizzle-kit studio\n\n`;
  } else if (orm === 'mongoose') {
    instructions += `1. Ensure MongoDB is running locally or update DATABASE_URL with your MongoDB connection string\n\n`;
    instructions += `2. The connection will be established automatically when your app starts\n\n`;
  } else {
    instructions += `1. Ensure your ${database} database is running\n\n`;
    instructions += `2. Update DATABASE_URL in .env.local with your connection details\n\n`;
    instructions += `3. Create tables manually or use migration tools\n\n`;
  }

  instructions += `📁 Generated Files:\n`;
  // List generated files based on ORM

  instructions += `\n📚 Documentation:\n`;
  if (orm === 'prisma') {
    instructions += `- Prisma: https://www.prisma.io/docs\n`;
    instructions += `- Next.js + Prisma: https://www.prisma.io/docs/guides/nextjs\n`;
  } else if (orm === 'drizzle') {
    instructions += `- Drizzle ORM: https://orm.drizzle.team/docs\n`;
    instructions += `- Next.js + Drizzle: https://orm.drizzle.team/docs/tutorials/drizzle-nextjs\n`;
  }

  return instructions;
}
```

---

## 9. Testing Checklist

### Core Functionality

- [ ] Generated project compiles without TypeScript errors
- [ ] Database connection string is properly formatted
- [ ] Environment variables are correctly set

### Prisma

- [ ] `npx prisma init` runs successfully
- [ ] `prisma/schema.prisma` is created with correct provider
- [ ] Schema has custom output directory configured (`../src/lib/db/generated/prisma`)
- [ ] Generated folder is added to .gitignore
- [ ] `src/lib/db/client.ts` imports from custom location
- [ ] Prisma client generates to `src/lib/db/generated/prisma`
- [ ] `npx prisma generate` completes without errors
- [ ] Migrations create tables successfully
- [ ] Can query database using Prisma client
- [ ] Works with PostgreSQL, MySQL, SQLite, MongoDB

### Drizzle

- [ ] `drizzle.config.ts` is generated correctly
- [ ] Schema file is generated with correct syntax
- [ ] Migrations generate successfully
- [ ] Migrations apply without errors
- [ ] Can query database using Drizzle client
- [ ] Works with PostgreSQL, MySQL, SQLite

### Mongoose

- [ ] Connection file handles MongoDB connection properly
- [ ] Models are defined correctly
- [ ] Can connect to MongoDB
- [ ] Can perform CRUD operations

### Direct Drivers

- [ ] Connection pools are configured correctly
- [ ] Can connect to database
- [ ] Query helper functions work
- [ ] Works with all supported databases

---

## 10. Summary

This specification provides a complete blueprint for database setup that:

1. ✅ Validates ORM/Database compatibility
2. ✅ Creates proper directory structure for each ORM
3. ✅ Generates appropriate configuration files
4. ✅ Sets up connection pooling and best practices
5. ✅ Provides clear post-setup instructions
6. ✅ Supports all database and ORM combinations
7. ✅ Ready for authentication integration (better-auth schemas can be added)
8. ✅ Follows Next.js 15 and TypeScript best practices

The database setup will be **complete and functional** before authentication setup begins, ensuring auth can properly add its required tables/models to the existing database configuration.
