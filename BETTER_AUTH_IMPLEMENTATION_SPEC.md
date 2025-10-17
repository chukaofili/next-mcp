# Better-Auth + Better-Auth-UI Implementation Specification

## Overview

This document outlines the complete implementation plan for integrating better-auth with better-auth-ui into the Next.js MCP scaffolding tool. By using better-auth-ui, we leverage production-ready, beautifully styled authentication components built with shadcn/ui, eliminating the need for custom auth UI components.

---

## 1. File Structure

When `config.architecture.auth === 'better-auth'`, the following file structure will be created:

```
project-root/
├── src/
│   ├── lib/
│   │   ├── auth.ts                  # Server-side auth configuration
│   │   └── auth-client.ts           # Client-side auth client
│   ├── providers/
│   │   └── auth-ui-provider.tsx     # Better Auth UI provider wrapper
│   ├── app/
│   │   ├── api/
│   │   │   └── auth/
│   │   │       └── [...all]/
│   │   │           └── route.ts     # Auth API route handler
│   │   ├── auth/
│   │   │   └── [path]/
│   │   │       └── page.tsx         # Dynamic auth pages (sign-in, sign-up, etc.)
│   │   ├── account/
│   │   │   └── [path]/
│   │   │       └── page.tsx         # Account settings pages
│   │   └── layout.tsx               # Root layout with AuthUIProvider
│   └── components/
│       └── auth/
│           └── user-button.tsx      # Custom UserButton wrapper (optional)
├── .env.example                     # Environment variables template
└── .env.local                       # Generated env file (gitignored)
```

**Key Changes:**

- ✅ No custom form components needed - better-auth-ui provides them
- ✅ Dynamic auth routes at `/auth/[path]` handle all auth views automatically
- ✅ Account settings at `/account/[path]` for user profile management
- ✅ AuthUIProvider wrapper component for app-wide auth context
- ✅ Simplified structure with fewer files to maintain

---

## 2. Dependencies

### Core Dependencies

- `better-auth@^1.3.27` (already in package.json line 542)
- `@daveyplate/better-auth-ui@latest` (NEW - provides all UI components)

### Database Adapter Dependencies (conditionally added based on ORM choice)

**For Prisma:**

- No additional package needed (adapter included in better-auth)
- Uses: `better-auth/adapters/prisma`

**For Drizzle:**

- No additional package needed (adapter included in better-auth)
- Uses: `better-auth/adapters/drizzle`

**For none (direct database drivers):**

- PostgreSQL: `pg` (already added for postgres)
- MySQL: `mysql2` (already added for mysql)
- SQLite: `better-sqlite3` (already added for sqlite)

### Styling Dependencies (already present)

- TailwindCSS (included in Next.js scaffold)
- shadcn/ui components (if `uiLibrary === 'shadcn'`)

---

## 3. Environment Variables

### Required Variables

```env
# Better Auth Configuration
BETTER_AUTH_SECRET=<generate-random-secret>
BETTER_AUTH_URL=http://localhost:3000

# Database Connection (based on selected database)
DATABASE_URL=<database-connection-string>
```

### Optional Variables (for OAuth providers)

```env
# GitHub OAuth (optional)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Secret Generation

Generate `BETTER_AUTH_SECRET` using Node.js crypto:

```javascript
import { randomBytes } from 'crypto';

const secret = randomBytes(32).toString('base64');
```

---

## 4. TailwindCSS Configuration

Better-auth-ui requires TailwindCSS configuration to include its component styles.

### For TailwindCSS v4 (Next.js 15 default)

Add to global CSS file (`src/app/globals.css`):

```css
@import '@daveyplate/better-auth-ui/css';
```

### For TailwindCSS v3

Add to `tailwind.config.js` content array:

```javascript
content: [
  // ... existing content
  './node_modules/@daveyplate/better-auth-ui/dist/**/*.{js,ts,jsx,tsx,mdx}',
];
```

---

## 5. Template Files to Create

### Template: `src/templates/auth/auth.ts.template`

```typescript
import { betterAuth } from 'better-auth';

__ADAPTER_IMPORT__;

export const auth = betterAuth({
  database: __DATABASE_CONFIG__,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    // Uncomment and configure OAuth providers as needed
    // github: {
    //   clientId: process.env.GITHUB_CLIENT_ID || "",
    //   clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    // },
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID || "",
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    // },
  },
});

export type Session = typeof auth.$Infer.Session;
```

**Placeholders:**

- `__ADAPTER_IMPORT__`: Adapter-specific import statement
- `__DATABASE_CONFIG__`: Database configuration based on ORM choice

### Template: `src/templates/auth/auth-client.ts.template`

```typescript
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});
```

### Template: `src/templates/auth/auth-route.ts.template`

```typescript
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
```

### Template: `src/templates/auth/auth-ui-provider.tsx.template`

```typescript
"use client";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => {
        // Clear router cache (protected routes)
        router.refresh()
      }}
      Link={Link}
    >
      {children}
    </AuthUIProvider>
  );
}
```

### Template: `src/templates/auth/auth-page.tsx.template`

```typescript
import { AuthView } from "@daveyplate/better-auth-ui";
import { authViewPaths } from "@daveyplate/better-auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

interface AuthPageProps {
  params: Promise<{ path: string }>;
}

export default async function AuthPage({ params }: AuthPageProps) {
  const { path } = await params;
  return <AuthView path={path} />;
}
```

**Available Auth Routes:**

- `/auth/sign-in` - Sign in page
- `/auth/sign-up` - Sign up page
- `/auth/magic-link` - Magic link authentication
- `/auth/forgot-password` - Forgot password page
- `/auth/reset-password` - Reset password page
- `/auth/two-factor` - Two-factor authentication
- `/auth/recover-account` - Account recovery
- `/auth/sign-out` - Sign out page
- `/auth/callback` - OAuth callback handler
- `/auth/accept-invitation` - Organization invitation acceptance

### Template: `src/templates/auth/account-page.tsx.template`

```typescript
import { AccountView } from "@daveyplate/better-auth-ui";
import { accountViewPaths } from "@daveyplate/better-auth-ui/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(accountViewPaths).map((path) => ({ path }));
}

interface AccountPageProps {
  params: Promise<{ path: string }>;
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { path } = await params;
  return <AccountView path={path} />;
}
```

**Available Account Routes:**

- `/account/profile` - User profile settings
- `/account/security` - Security settings
- `/account/sessions` - Active sessions management
- `/account/delete` - Account deletion

### Template: `src/templates/auth/user-button.tsx.template`

```typescript
"use client";

import { UserButton as BetterAuthUserButton } from "@daveyplate/better-auth-ui";

export function UserButton() {
  return <BetterAuthUserButton />;
}
```

---

## 5. Database Configuration by ORM

### Prisma Configuration

**Adapter Import:**

```typescript
import { PrismaClient } from '@/generated/prisma';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const prisma = new PrismaClient();
```

**Database Config:**

```typescript
prismaAdapter(prisma, {
  provider: 'postgresql', // or "mysql", "sqlite"
});
```

**Schema Generation Command:**

```bash
npx @better-auth/cli@latest generate
```

**Migration Command:**

```bash
npx prisma migrate dev
```

### Drizzle Configuration

**Adapter Import:**

```typescript
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '@/lib/db';
```

**Database Config:**

```typescript
drizzleAdapter(db, {
  provider: 'pg', // or "mysql", "sqlite"
});
```

**Schema Generation Command:**

```bash
npx @better-auth/cli@latest generate
```

**Migration Commands:**

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

### No ORM (Direct Database Connection)

**Adapter Import:**

```typescript
// For PostgreSQL

// For SQLite
import Database from 'better-sqlite3';
// For MySQL
import mysql from 'mysql2/promise';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const pool = mysql.createPool(process.env.DATABASE_URL);

const db = new Database('./sqlite.db');
```

**Database Config:**

```typescript
// For PostgreSQL or MySQL
pool;

// For SQLite
db;
```

---

## 6. Root Layout Update

Update the root layout to wrap the app with AuthProvider:

### Template: `src/templates/auth/layout-wrapper.tsx.template`

```typescript
import { AuthProvider } from "@/providers/auth-ui-provider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

**Note:** This will be merged with existing layout.tsx content, not replace it entirely.

---

## 7. Implementation Steps for `setupAuthentication` Method

### Step 1: Early Exit for 'none'

```typescript
if (config.architecture.auth === 'none') {
  return {
    content: [
      {
        type: 'text',
        text: 'No authentication configuration needed',
      },
    ],
  };
}
```

### Step 2: Create Directory Structure

```typescript
const authDirs = [
  'src/lib/auth',
  'src/providers',
  'src/app/api/auth/[...all]',
  'src/app/auth/[path]',
  'src/app/account/[path]',
  'src/components/auth',
];

for (const dir of authDirs) {
  await fs.mkdir(path.join(projectPath, dir), { recursive: true });
}
```

### Step 3: Generate Environment Variables

```typescript
// Generate random secret
const secret = randomBytes(32).toString('base64');

// Create .env.example
const envExample = `# Better Auth Configuration
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# Database Connection
DATABASE_URL=${getDatabaseUrlTemplate(config)}

# OAuth Providers (optional)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
`;

// Create .env.local with actual secret
const envLocal = envExample.replace('your-secret-key-here', secret);

await fs.writeFile(path.join(projectPath, '.env.example'), envExample);
await fs.writeFile(path.join(projectPath, '.env.local'), envLocal);
```

### Step 4: Generate Auth Configuration Files

```typescript
// Read templates
const authTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth.ts.template'), 'utf-8');
const authClientTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-client.ts.template'), 'utf-8');
const routeTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-route.ts.template'), 'utf-8');

// Replace placeholders based on ORM
const { adapterImport, databaseConfig } = getAdapterConfig(config);
const authContent = authTemplate
  .replace('__ADAPTER_IMPORT__', adapterImport)
  .replace('__DATABASE_CONFIG__', databaseConfig);

// Write files
await fs.writeFile(path.join(projectPath, 'src/lib/auth/auth.ts'), authContent);
await fs.writeFile(path.join(projectPath, 'src/lib/auth/auth-client.ts'), authClientTemplate);
await fs.writeFile(path.join(projectPath, 'src/app/api/auth/[...all]/route.ts'), routeTemplate);
```

### Step 5: Generate Auth Provider

```typescript
// Read AuthUIProvider template
const authProviderTemplate = await fs.readFile(
  path.join(__dirname, 'templates/auth/auth-ui-provider.tsx.template'),
  'utf-8'
);

// Write provider file
await fs.writeFile(path.join(projectPath, 'src/providers/auth-ui-provider.tsx'), authProviderTemplate);
```

### Step 6: Generate Auth Pages (Dynamic Routes)

```typescript
// Read auth page template
const authPageTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/auth-page.tsx.template'), 'utf-8');

// Read account page template
const accountPageTemplate = await fs.readFile(
  path.join(__dirname, 'templates/auth/account-page.tsx.template'),
  'utf-8'
);

// Write dynamic auth pages
await fs.writeFile(path.join(projectPath, 'src/app/auth/[path]/page.tsx'), authPageTemplate);

await fs.writeFile(path.join(projectPath, 'src/app/account/[path]/page.tsx'), accountPageTemplate);
```

### Step 7: Generate UserButton Component

```typescript
// Read UserButton template
const userButtonTemplate = await fs.readFile(path.join(__dirname, 'templates/auth/user-button.tsx.template'), 'utf-8');

// Write UserButton component
await fs.writeFile(path.join(projectPath, 'src/components/auth/user-button.tsx'), userButtonTemplate);
```

### Step 8: Update Root Layout

```typescript
// Read existing layout.tsx
const layoutPath = path.join(projectPath, 'src/app/layout.tsx');
let layoutContent = await fs.readFile(layoutPath, 'utf-8');

// Add AuthProvider import at the top
if (!layoutContent.includes('AuthProvider')) {
  const importStatement = `import { AuthProvider } from "@/providers/auth-ui-provider";\n`;
  layoutContent = layoutContent.replace(/^(import.*\n)*/, (match) => match + importStatement);

  // Wrap children with AuthProvider
  layoutContent = layoutContent.replace(/<body[^>]*>([\s\S]*?)<\/body>/, (match, content) =>
    match.replace(content, `\n        <AuthProvider>${content}</AuthProvider>\n      `)
  );

  await fs.writeFile(layoutPath, layoutContent);
}
```

### Step 9: Update Global CSS (TailwindCSS v4)

```typescript
// Read existing globals.css
const globalsCssPath = path.join(projectPath, 'src/app/globals.css');
let globalsCss = await fs.readFile(globalsCssPath, 'utf-8');

// Add better-auth-ui CSS import
if (!globalsCss.includes('@daveyplate/better-auth-ui/css')) {
  globalsCss = `@import "@daveyplate/better-auth-ui/css";\n\n${globalsCss}`;
  await fs.writeFile(globalsCssPath, globalsCss);
}
```

### Step 10: Add Post-Setup Instructions

```typescript
const instructions = `
✅ Better Auth + Better Auth UI has been configured successfully!

📋 Next Steps:

1. Generate the database schema:
   ${getSchemaCommand(config)}

2. Run database migrations:
   ${getMigrationCommand(config)}

3. Update environment variables in .env.local if needed

4. Start your development server:
   ${config.architecture.packageManager} dev

5. Visit http://localhost:3000/auth/sign-up to create your first user

📚 Documentation:
- Better Auth: https://www.better-auth.com/docs
- Better Auth UI: https://better-auth-ui.com
- Email & Password Auth: https://www.better-auth.com/docs/authentication/email-password
- Client Usage: https://www.better-auth.com/docs/concepts/client

🎨 Available Auth Routes:
- /auth/sign-in - Sign in page
- /auth/sign-up - Sign up page
- /auth/forgot-password - Password reset
- /auth/two-factor - 2FA setup
- /account/profile - User profile settings
- /account/security - Security settings
- /account/sessions - Active sessions

🔐 Features Enabled:
- Email & Password Authentication with beautiful UI
- Session Management
- Account Settings Pages
- User Profile Management
- Pre-styled shadcn/ui components
- Ready-to-use UserButton component

📁 Generated Files:
- src/lib/auth/auth.ts (server config)
- src/lib/auth/auth-client.ts (client)
- src/providers/auth-ui-provider.tsx (UI provider)
- src/app/api/auth/[...all]/route.ts (API handler)
- src/app/auth/[path]/page.tsx (dynamic auth pages)
- src/app/account/[path]/page.tsx (account settings)
- src/components/auth/user-button.tsx (UserButton wrapper)
- .env.example (environment template)
- .env.local (with generated secret)

💡 Quick Start:
Add the UserButton to your layout/navbar:

import { UserButton } from "@/components/auth/user-button";

export default function Header() {
  return (
    <header>
      <nav>
        {/* Your navigation */}
        <UserButton />
      </nav>
    </header>
  );
}
`;

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

### `getAdapterConfig(config: ProjectConfig)`

```typescript
function getAdapterConfig(config: ProjectConfig): {
  adapterImport: string;
  databaseConfig: string;
} {
  const { database, orm } = config.architecture;

  if (orm === 'prisma') {
    return {
      adapterImport: `import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();`,
      databaseConfig: `prismaAdapter(prisma, {
    provider: "${getPrismaProvider(database)}",
  })`,
    };
  }

  if (orm === 'drizzle') {
    return {
      adapterImport: `import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";`,
      databaseConfig: `drizzleAdapter(db, {
    provider: "${getDrizzleProvider(database)}",
  })`,
    };
  }

  // Direct database connection
  return getDirectDatabaseConfig(database);
}
```

### `getDatabaseUrlTemplate(config: ProjectConfig)`

```typescript
function getDatabaseUrlTemplate(config: ProjectConfig): string {
  const { database } = config.architecture;

  switch (database) {
    case 'postgres':
      return 'postgresql://postgres:postgres@localhost:5432/mydb';
    case 'mysql':
      return 'mysql://root:password@localhost:3306/mydb';
    case 'sqlite':
      return 'file:./dev.db';
    case 'mongodb':
      return 'mongodb://localhost:27017/mydb';
    default:
      return '';
  }
}
```

### `getSchemaCommand(config: ProjectConfig)`

```typescript
function getSchemaCommand(config: ProjectConfig): string {
  return 'npx @better-auth/cli@latest generate';
}
```

### `getMigrationCommand(config: ProjectConfig)`

```typescript
function getMigrationCommand(config: ProjectConfig): string {
  const { orm } = config.architecture;

  if (orm === 'prisma') {
    return 'npx prisma migrate dev';
  }

  if (orm === 'drizzle') {
    return 'npx drizzle-kit generate && npx drizzle-kit migrate';
  }

  return 'npx @better-auth/cli@latest migrate';
}
```

---

## 9. Testing Checklist

### Core Functionality

- [ ] Generated project compiles without TypeScript errors
- [ ] Database schema generates successfully
- [ ] Migrations run without errors
- [ ] Sign-up flow creates new users at `/auth/sign-up`
- [ ] Sign-in flow authenticates existing users at `/auth/sign-in`
- [ ] Sign-out clears session
- [ ] Forgot password flow works at `/auth/forgot-password`
- [ ] Environment variables are properly set

### UI Components

- [ ] better-auth-ui CSS imports correctly in globals.css
- [ ] AuthView component renders all auth pages
- [ ] AccountView component renders all account pages
- [ ] UserButton component displays correctly
- [ ] UserButton shows user info when logged in
- [ ] UserButton shows sign-in/sign-up when logged out
- [ ] All forms are styled with shadcn/ui components

### Session Management

- [ ] useSession hook returns correct data
- [ ] Session persists after page refresh
- [ ] AuthProvider wraps the app correctly
- [ ] onSessionChange triggers router.refresh()
- [ ] Protected routes redirect to sign-in

### Database Adapters

- [ ] Works with Prisma adapter
- [ ] Works with Drizzle adapter
- [ ] Works with direct database connections
- [ ] Works with all supported databases (PostgreSQL, MySQL, SQLite)

### Integration

- [ ] Works with shadcn/ui when enabled
- [ ] Works without shadcn/ui (using TailwindCSS defaults)
- [ ] Dynamic routes generate static params correctly
- [ ] All auth routes are accessible
- [ ] All account routes are accessible

---

## 10. Documentation Updates Needed

### README.md Additions

Add section about authentication:

````markdown
## Authentication

This project uses **Better Auth** with **Better Auth UI** for a complete, production-ready authentication system with beautiful, pre-styled components.

### Quick Start

1. Generate database schema:
   ```bash
   npx @better-auth/cli@latest generate
   ```
````

2. Run migrations:

   ```bash
   npx prisma migrate dev  # or appropriate command for your ORM
   ```

3. Start the dev server:

   ```bash
   pnpm dev
   ```

4. Visit `/auth/sign-up` to create your first user

### Available Auth Routes

- `/auth/sign-in` - Sign in to your account
- `/auth/sign-up` - Create a new account
- `/auth/forgot-password` - Reset your password
- `/auth/two-factor` - Set up 2FA
- `/account/profile` - Manage your profile
- `/account/security` - Security settings
- `/account/sessions` - View active sessions

### Using the UserButton

The UserButton component is pre-configured and ready to use:

```tsx
import { UserButton } from '@/components/auth/user-button';

export default function Header() {
  return (
    <header>
      <nav>
        {/* Your navigation items */}
        <UserButton />
      </nav>
    </header>
  );
}
```

### Environment Variables

Copy `.env.example` to `.env.local` and update:

- `BETTER_AUTH_SECRET`: Keep the generated value or create your own
- `DATABASE_URL`: Update with your database connection string

### Adding OAuth Providers

To add GitHub or Google authentication:

1. Create OAuth app on GitHub/Google developer console
2. Add credentials to `.env.local`:
   ```env
   GITHUB_CLIENT_ID=your_github_client_id
   GITHUB_CLIENT_SECRET=your_github_secret
   ```
3. Uncomment provider config in `src/lib/auth/auth.ts`

### Customization

Better Auth UI components are built with shadcn/ui and TailwindCSS, making them fully customizable. See the [Better Auth UI documentation](https://better-auth-ui.com) for customization options.

````

---

## 11. Edge Cases & Error Handling

### No Database Selected
```typescript
if (config.architecture.database === 'none') {
  throw new Error('Better Auth requires a database. Please select a database option.');
}
````

### Incompatible ORM/Database Combination

```typescript
if (config.architecture.orm === 'mongoose' && config.architecture.database !== 'mongodb') {
  throw new Error('Mongoose ORM requires MongoDB database');
}
```

### Missing Required Dependencies

Verify all required packages are in package.json before proceeding.

---

## 12. Summary

This specification provides a complete blueprint for implementing better-auth with better-auth-ui integration. The implementation will:

1. ✅ Create proper file structure in `src/lib/auth/` and `src/providers/`
2. ✅ Generate all necessary template files (significantly fewer than custom components!)
3. ✅ Configure database adapters based on ORM choice
4. ✅ Use better-auth-ui for production-ready, pre-styled auth components
5. ✅ Generate environment variables with secure defaults
6. ✅ Provide clear post-setup instructions
7. ✅ Handle all edge cases gracefully
8. ✅ Support all database and ORM combinations
9. ✅ Include dynamic auth and account routes
10. ✅ Integrate AuthUIProvider into the app layout
11. ✅ Configure TailwindCSS for better-auth-ui styles

### Key Benefits of Using Better Auth UI:

- **Zero Custom Components**: No need to build forms, buttons, or auth UI from scratch
- **Beautiful by Default**: Professional, polished components built with shadcn/ui
- **Feature Complete**: Sign-in, sign-up, password reset, 2FA, account settings, and more
- **Fully Typed**: TypeScript support out of the box
- **Customizable**: Built on TailwindCSS and shadcn/ui for easy styling
- **Maintainable**: Updates to auth UI handled by the library
- **Time Saver**: Reduces implementation time significantly

The implementation follows better-auth and better-auth-ui best practices, and Next.js 15 App Router conventions.
