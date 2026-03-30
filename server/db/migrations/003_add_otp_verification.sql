-- Migration 003: Add OTP-based email verification
-- - Creates pending_registrations table for OTP storage (Option A)
-- - Adds email_verified column to users (Option C — existing rows set TRUE)

-- Pending registrations: stores signup data + OTP until verified
CREATE TABLE IF NOT EXISTS pending_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one pending registration per email at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_email
  ON pending_registrations (email);

-- Auto-cleanup: index on expires_at for efficient deletion of expired rows
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires
  ON pending_registrations (expires_at);

-- Add email_verified to users; existing accounts are grandfathered as verified
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE;
