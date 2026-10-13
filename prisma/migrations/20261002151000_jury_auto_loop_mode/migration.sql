-- Execution mode is separate from the enabled switch and from loop-guard limits.
ALTER TABLE "JuryAutoLoopActivation" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'OFF';
