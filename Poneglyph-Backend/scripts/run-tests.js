const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env.test'), quiet: true });
process.env.NODE_ENV = 'test';

if (!process.env.DATABASE_URL || !/test/i.test(new URL(process.env.DATABASE_URL).pathname)) {
    console.error('Refusing to run: .env.test must define DATABASE_URL pointing at a database with "test" in its name');
    process.exit(1);
}

const run = (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });

const migrate = run('npx', ['prisma', 'migrate', 'deploy']);
if (migrate.status !== 0) {
    process.exit(migrate.status ?? 1);
}

const tests = run('node', ['--test', '--test-concurrency=1', 'tests/*.test.js']);
process.exit(tests.status ?? 1);
