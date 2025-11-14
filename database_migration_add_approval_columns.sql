-- Migration: add approval workflow columns to ticket table
-- Run on your MySQL server after taking a backup. This migration adds ApprovalStatus, ActionedBy, ActionedDate,
-- ActionComments, ApprovalToken and TokenExpiry columns and a foreign key referencing the user table.

USE it_supporter;

ALTER TABLE ticket
ADD COLUMN ApprovalStatus ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending' AFTER Status,
ADD COLUMN ActionedBy INT NULL AFTER ApprovalStatus, 
ADD COLUMN ActionedDate DATETIME NULL AFTER ActionedBy,  
ADD COLUMN ActionComments TEXT NULL AFTER ActionedDate,
ADD COLUMN ApprovalToken VARCHAR(255) UNIQUE NULL AFTER ActionComments,  
ADD COLUMN TokenExpiry DATETIME NULL AFTER ApprovalToken;  


ALTER TABLE ticket
ADD CONSTRAINT fk_ticket_actioned_by
FOREIGN KEY (ActionedBy)
REFERENCES user(Id)
ON DELETE SET NULL;

-- Rollback (if you need to revert):
-- ALTER TABLE ticket DROP FOREIGN KEY fk_ticket_actioned_by;
-- ALTER TABLE ticket DROP COLUMN TokenExpiry, DROP COLUMN ApprovalToken, DROP COLUMN ActionComments, DROP COLUMN ActionedDate, DROP COLUMN ActionedBy, DROP COLUMN ApprovalStatus;
