/**
 * Build-time migration policy. Pure function, kept for compatibility: the general build
 * (`run-build.cjs`) no longer calls it, and the build never runs database migrations.
 * Returns only a boolean and a fixed reason code; never returns or logs environment values.
 *
 * Every input (local, Preview, Production, any JURY_ALLOW_PROD_MIGRATE or
 * JURY_SKIP_MIGRATIONS value) yields { run: false, reason: 'BUILD_MIGRATE_DISABLED' }.
 * Migrations are a separate, separately approved operation outside the build.
 */
'use strict';

function decideMigrate() {
  return { run: false, reason: 'BUILD_MIGRATE_DISABLED' };
}

module.exports = { decideMigrate };