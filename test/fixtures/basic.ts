import type { Payload } from "../../external.ts";
import packageJson from "../../package.json" with { type: "json" };

export default {
  "~pullfrog": true,
  version: packageJson.version,
  prompt:
    "List all files in the current directory, then create a file called dynamic-test.txt with the content 'This was loaded from a TypeScript file!', then delete it.",
  event: {
    trigger: "workflow_dispatch",
  },
} satisfies Payload;
