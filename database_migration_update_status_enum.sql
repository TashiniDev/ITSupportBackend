-- Migration: Update ticket Status enum to include new status values
-- Run this on your MySQL server after taking a backup
-- This migration updates the Status column ENUM values to include all new statuses

USE it_supporter;

-- Update the Status column enum values
ALTER TABLE ticket 
MODIFY COLUMN Status ENUM('NEW', 'OPEN', 'PROCESSING', 'COMPLETED', 'ON_HOLD', 'PENDING APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED') DEFAULT 'NEW';

-- Update any existing 'OPEN' status records to 'NEW' if needed
-- (This is optional - uncomment if you want to migrate existing OPEN tickets to NEW)
-- UPDATE ticket SET Status = 'NEW' WHERE Status = 'OPEN';

-- Update any existing 'IN_PROGRESS' status records to 'PROCESSING' if needed  
-- (This is optional - uncomment if you want to migrate existing IN_PROGRESS tickets to PROCESSING)
-- UPDATE ticket SET Status = 'PROCESSING' WHERE Status = 'IN_PROGRESS';

-- Update any existing 'RESOLVED' status records to 'COMPLETED' if needed
-- (This is optional - uncomment if you want to migrate existing RESOLVED tickets to COMPLETED)
-- UPDATE ticket SET Status = 'COMPLETED' WHERE Status = 'RESOLVED';

-- Rollback (if you need to revert to old enum values):
-- ALTER TABLE ticket 
-- MODIFY COLUMN Status ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') DEFAULT 'OPEN';