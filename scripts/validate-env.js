#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Environment Variable Validation Script
 * Ensures all required environment variables are set before build/dev
 */

const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

// Optional but recommended
const recommended = [
  'SUPABASE_SERVICE_ROLE_KEY',
];

console.log('🔍 Validating environment variables...\n');

const missing = required.filter(key => !process.env[key]);
const missingRecommended = recommended.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(key => console.error(`  - ${key}`));
  console.error('\n📝 Please create a .env.local file with these variables');
  console.error('   You can copy .env.example as a template\n');
  process.exit(1);
}

if (missingRecommended.length > 0) {
  console.warn('⚠️  Missing recommended environment variables:');
  missingRecommended.forEach(key => console.warn(`  - ${key}`));
  console.warn('   These are optional but may be needed for full functionality\n');
}

// Validate URL format
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl && !supabaseUrl.startsWith('https://')) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL must start with https://');
  process.exit(1);
}

if (supabaseUrl && !supabaseUrl.includes('.supabase.co')) {
  console.warn('⚠️  NEXT_PUBLIC_SUPABASE_URL does not appear to be a Supabase URL');
}

// Validate key format (JWT or modern publishable key)
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (anonKey && !anonKey.startsWith('eyJ') && !anonKey.startsWith('sbp_')) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_ANON_KEY does not appear to be a valid Supabase key (expected eyJ... or sbp_...)');
  process.exit(1);
}

console.log('✅ All required environment variables are set');
console.log('✅ Environment validation passed\n');
