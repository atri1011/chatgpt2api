import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webDir = resolve(rootDir, 'web')
const outDir = resolve(rootDir, 'web_dist')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (!existsSync(webDir)) {
    throw new Error(`web directory not found: ${webDir}`)
}

execSync(`${npmCmd} install`, {
    cwd: webDir,
    stdio: 'inherit',
})

execSync(`${npmCmd} run build`, {
    cwd: webDir,
    stdio: 'inherit',
    env: {
        ...process.env,
        NEXT_PUBLIC_APP_VERSION:
            process.env.NEXT_PUBLIC_APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'vercel',
    },
})

const exportedDir = resolve(webDir, 'out')
if (!existsSync(exportedDir)) {
    throw new Error(`Next export output not found: ${exportedDir}`)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(exportedDir, outDir, { recursive: true })