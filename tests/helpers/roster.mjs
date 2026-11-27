// Synthetic data only. Never use real participant names in tests.
export const testRoster = Array.from({ length: 26 }, (_, index) =>
  `Test Participant ${String(index + 1).padStart(2, '0')}`);
