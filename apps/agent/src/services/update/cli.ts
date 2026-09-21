/**
 * CLI: npm run system-update / system-update:status.
 * allowLocalCli = true (локальный админ на машине, owner не обязателен).
 */
import { SystemUpdateService } from "./SystemUpdateService.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantStatus = args.includes("--status");
  const svc = new SystemUpdateService({ repoDir: process.cwd(), allowLocalCli: true });

  const result = wantStatus ? await svc.status() : await svc.run({ fromCli: true });

  if (result.ok) {
    if (wantStatus) {
      console.log(`remote=${result.remote}`);
      console.log(`branch=${result.branch}`);
      console.log(`sha=${result.beforeSha}`);
      const dirty = result.log.find((l) => l.startsWith("dirty=")) ?? "dirty=no";
      console.log(dirty);
    } else {
      const tail = result.restarted
        ? "restarted"
        : result.beforeSha === result.afterSha
          ? "already up to date"
          : "updated";
      console.log(`${tail}: ${result.beforeSha} → ${result.afterSha}`);
    }
  } else {
    console.error(`ERROR ${result.code}: ${result.message}`);
    for (const line of result.log) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}

main();
