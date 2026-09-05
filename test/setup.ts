import { config } from 'dotenv';

process.env.NODE_ENV = 'test';
config({ path: '.env.test' });

if (!process.env.DEBUG_TESTS) {
  console.log = () => undefined;
}
