# Quick Publishing Guide

## TL;DR - Publish to npm

```bash
# 1. Login to npm (one-time)
npm login

# 2. Verify you're logged in
npm whoami

# 3. Build and test
pnpm build
pnpm test

# 4. Check what will be published
npm pack --dry-run

# 5. Publish to npm
npm publish

# Done! 🎉
```

## What happens when you run `npm publish`?

1. **prepublishOnly script runs** → Builds the package
2. **Files are packaged** → According to `files` field in package.json
3. **Uploaded to npm registry** → Available at npmjs.com
4. **Publishes as public** → Due to `publishConfig.access: "public"`

## Publishing Updates

```bash
# Patch version (1.0.0 → 1.0.1) - Bug fixes
npm version patch

# Minor version (1.0.0 → 1.1.0) - New features
npm version minor

# Major version (1.0.0 → 2.0.0) - Breaking changes
npm version major

# Then publish
npm publish
```

## Installation After Publishing

Users can install your package:

```bash
# Global installation
npm install -g @chukaofili/next-mcp

# Run the CLI
next-mcp

# Or use with npx (no installation needed)
npx @chukaofili/next-mcp
```

## Verification

After publishing, verify at:

- https://www.npmjs.com/package/@chukaofili/next-mcp

## First Time Setup

If this is your first time publishing:

1. **Create npm account**: https://www.npmjs.com/signup
2. **Verify email**: Check your inbox
3. **Enable 2FA**: https://www.npmjs.com/settings/[username]/tfa
4. **Login**: `npm login`

## Important Notes

- ✅ Package name: `@chukaofili/next-mcp` (scoped, unique)
- ✅ Version: `1.0.0` (semantic versioning)
- ✅ License: `MIT` (LICENSE file included)
- ✅ Access: `public` (configured in package.json)
- ✅ Files: Only `dist/`, `README.md`, `LICENSE`, `package.json`

## Before Publishing Checklist

- [ ] Logged into npm (`npm whoami`)
- [ ] All tests pass (`pnpm test`)
- [ ] README is complete
- [ ] LICENSE file exists
- [ ] Version is correct
- [ ] Changes are committed

## Need More Details?

See [PUBLISHING.md](./PUBLISHING.md) for comprehensive guide.
