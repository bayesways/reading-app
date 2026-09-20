#!/usr/bin/env node
import "tsx/esm";

const { main } = await import("../src/cli.ts");
main().catch((error) => {
  console.error(`pi-reader: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
