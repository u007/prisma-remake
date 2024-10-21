import { setupDatabase } from '../prisma/setup.js';

async function main() {
  console.log('Starting database push...');
  try {
    await setupDatabase();
    console.log('Database push completed successfully.');
  } catch (error) {
    console.error('Error during database push:', error);
    process.exit(1);
  }
}

main();