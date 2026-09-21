import { spawn } from 'node:child_process';

const server = spawn('node', ['src/server.js'], { cwd: 'server', stdio: 'inherit', shell: true });
const web = spawn('npx', ['vite', '--port', '5173', '--host'], { cwd: 'web', stdio: 'inherit', shell: true });

let serverExited = false;
let webExited = false;

function cleanup() {
  console.log('Shutting down...');
  if (!serverExited) {
    server.kill('SIGTERM');
  }
  if (!webExited) {
    web.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

server.on('exit', (code) => {
  serverExited = true;
  if (code !== 0) {
    console.error(`Server exited with code ${code}`);
    if (!webExited) {
      web.kill('SIGTERM');
    }
    process.exit(code);
  }
});

web.on('exit', (code) => {
  webExited = true;
  if (code !== 0) {
    console.error(`Web dev server exited with code ${code}`);
    if (!serverExited) {
      server.kill('SIGTERM');
    }
    process.exit(code);
  }
});
