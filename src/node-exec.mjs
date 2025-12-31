import {spawn} from 'node:child_process';

const command = 'echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts'
const cwd = process.cwd();

// 如果 SHELL 环境变量存在（在 Git Bash 中会设置），使用它；否则使用 shell: true
// 这样可以确保在 Git Bash 中使用 bash，在其他环境中使用默认 shell
const shellOption = process.env.SHELL || true;

// 当使用 shell: true 或指定 shell 时，应该直接传递整个命令字符串
const child = spawn(command, [], {
  cwd,
  stdio: 'inherit',
  shell: shellOption
})

let errorMsg = ''

child.on('error', (error) => {
  errorMsg = error.message
})

child.on('close', (code) => {
  if (code === 0) {
    process.exit(0)
  } else {
    if (errorMsg) {
      console.error(`错误： ${errorMsg}`)
    }
    process.exit(code || 1)
  }
})