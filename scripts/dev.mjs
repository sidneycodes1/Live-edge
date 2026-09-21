import { spawn } from 'node:child_process';
const server = spawn('node', ['src/server.js'], { cwd: 'server', stdio: 'inherit', shell: true });
const web = spawn('npx', ['vite', '--port', '5173', '--host'], { cwd: 'web', stdio: 'inherit', shell: true });
function cleanup(){ try{server.kill();}catch{ /* ignore */ } try{web.kill();}catch{ /* ignore */ } }
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
